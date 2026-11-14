import { weekRange } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { noDelegationHooks } from "../../src/modules/actions";
import {
  handleCallback,
  reviewMessage,
  type CallbackDeps,
  type CommandDeps,
  type LinkedChat,
} from "../../src/modules/channels";
import {
  getEmailFlags,
  setAnsweredCheck,
  touchEmailFlags,
  writeEmailFlags,
  type FlagRead,
} from "../../src/modules/mail";
import { configureFeatures, setOrgFeature } from "../../src/modules/tenancy";
import {
  ANSWERED_CHECK_WINDOW_MS,
  answerAnsweredCheck,
  countAnsweredWaiting,
  listAnsweredCandidates,
  listTruthRows,
} from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTriaged } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

// The answered check of /review (F100 stage 15): the candidate reader, the answer service, the page block and the taps.
const T = new Date("2026-11-20T12:00:00Z");
const DAY = 24 * 3_600_000;
const TEST_SENDER = "agent@test-sender.test";
const testMail = { senders: [TEST_SENDER] };
const OFF = { answer: "This button is off now." };

interface Org {
  orgId: string;
  userId: string;
  mailboxId: string;
}

const mail = (
  trx: Transaction<DB>,
  org: Org,
  subject: string,
  opts: { category?: "info" | "needs_reply" | "spam" | "notification"; ageMs?: number; from?: string } = {}
) =>
  insertTriaged(trx, { orgId: org.orgId }, org.mailboxId, {
    category: opts.category ?? "info",
    createdAt: new Date(T.getTime() - (opts.ageMs ?? 3_600_000)),
    subject,
    from: opts.from ?? "ann@firma.test",
  });

// A real flag read: the row that the flag refresh of the sync run writes.
async function readFlags(trx: Transaction<DB>, org: Org, emailId: string, flags: { answered: boolean }): Promise<void> {
  const row = await trx
    .selectFrom("emails")
    .select(["folder", "uid", "received_at"])
    .where("id", "=", emailId)
    .executeTakeFirstOrThrow();
  const read: FlagRead = {
    emailId,
    folder: row.folder,
    uid: Number(row.uid),
    messageId: null,
    receivedAt: row.received_at,
    seen: true,
    answered: flags.answered,
    flagged: false,
  };
  await writeEmailFlags(trx, { orgId: org.orgId }, [read], T);
}

const answeredMail = async (trx: Transaction<DB>, org: Org, subject: string, opts: Parameters<typeof mail>[3] = {}) => {
  const id = await mail(trx, org, subject, opts);
  await readFlags(trx, org, id, { answered: true });
  return id;
};

const since = new Date(T.getTime() - ANSWERED_CHECK_WINDOW_MS);
const candidates = (trx: Transaction<DB>, org: Org, limit = 5) =>
  listAnsweredCandidates(trx, { orgId: org.orgId }, { mailboxIds: [org.mailboxId], since, limit, testMail });

async function setup(trx: Transaction<DB>) {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  const link: LinkedChat = {
    orgId: a.orgId,
    userId: a.userId,
    role: "owner",
    chatId: 7,
    linkedAt: new Date(T.getTime() - 30 * DAY),
    locale: "en",
  };
  return { a, b, link };
}

const flagsOn = async (trx: Transaction<DB>, orgId: string, flags: ("review_command" | "answered_check")[]) => {
  for (const flag of flags) await setOrgFeature(trx, { orgId }, { flag, enabled: true, actor: "cli", now: T });
};

const commandDeps = (trx: Transaction<DB>): CommandDeps => ({
  db: trx,
  now: () => T,
  llmDailyCap: 300,
  triageScope: "all",
  actionsScope: { kind: "all" },
  llm: { provider: "gemini", classifierModel: "gemini-3.5-flash-lite" },
  hooks: noDelegationHooks,
  uidplus: async () => true,
  sendScope: { kind: "all" },
  syncEveryMin: 2,
  testMail,
  operatorContact: null,
});

const callbackDeps = (trx: Transaction<DB>): CallbackDeps => ({
  db: trx,
  now: () => T,
  actionsScope: { kind: "all" },
  hooks: noDelegationHooks,
  uidplus: async () => true,
  sendScope: { kind: "all" },
});

async function truthOf(trx: Transaction<DB>, org: Org, emailId: string) {
  const range = weekRange("2026-11-16", "Europe/Warsaw");
  const rows = await listTruthRows(trx, { orgId: org.orgId }, { range, mailboxId: null, testMail });
  return rows.find((row) => row.emailId === emailId);
}

const feedbackOf = (trx: Transaction<DB>, emailId: string) =>
  trx.selectFrom("triage_feedback").selectAll().where("email_id", "=", emailId).execute();

describe("the answered check", () => {
  test("1. candidates: answered, quiet category, no label, no answer, real, recent, own organization, oldest first", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await setup(trx);
      const old = await answeredMail(trx, a, "OLD-INFO", { category: "info", ageMs: 3 * DAY });
      const spam = await answeredMail(trx, a, "NEW-SPAM", { category: "spam", ageMs: DAY });
      await answeredMail(trx, a, "NEEDS-REPLY", { category: "needs_reply" });
      const labelled = await answeredMail(trx, a, "LABELLED");
      await trx
        .insertInto("triage_feedback")
        .values({
          org_id: a.orgId,
          user_id: a.userId,
          email_id: labelled,
          verdict: "right",
          true_category: "info",
          source: "telegram",
        })
        .execute();
      const answered = await answeredMail(trx, a, "ANSWERED-NO");
      await trx
        .updateTable("email_flags")
        .set({ answered_check: "no", answered_check_at: T })
        .where("email_id", "=", answered)
        .execute();
      await answeredMail(trx, a, "TOO-OLD", { ageMs: 20 * DAY });
      await answeredMail(trx, a, "TEST-SENDER", { from: TEST_SENDER });
      await answeredMail(trx, b, "OTHER-ORG");

      const rows = await candidates(trx, a);

      expect(rows.map((row) => row.emailId)).toEqual([old, spam]);
      expect(rows[0]).toMatchObject({ category: "info", from: "ann@firma.test", subject: "OLD-INFO" });
      expect(await countAnsweredWaiting(trx, { orgId: a.orgId }, { since, testMail })).toBe(2);
      expect(await candidates(trx, a, 1)).toHaveLength(1);
      expect(await candidates(trx, b)).toHaveLength(1);
    });
  });

  test("1b. a 'last tried' row and an unanswered read are no candidates and cannot be answered", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await setup(trx);
      const touched = await mail(trx, a, "TOUCHED");
      const row = await trx
        .selectFrom("emails")
        .select(["folder", "uid", "received_at"])
        .where("id", "=", touched)
        .executeTakeFirstOrThrow();
      const target = {
        emailId: touched,
        folder: row.folder,
        uid: Number(row.uid),
        messageId: null,
        receivedAt: row.received_at,
      };
      expect(await touchEmailFlags(trx, { orgId: a.orgId }, [target], T)).toBe(1);
      const unanswered = await mail(trx, a, "READ-UNANSWERED");
      await readFlags(trx, a, unanswered, { answered: false });
      const noRow = await mail(trx, a, "NO-ROW");

      expect(await candidates(trx, a)).toEqual([]);
      expect(await countAnsweredWaiting(trx, { orgId: a.orgId }, { since, testMail })).toBe(0);
      for (const emailId of [touched, unanswered, noRow]) {
        expect(
          await answerAnsweredCheck(trx, { orgId: a.orgId }, { emailId, answer: "yes", userId: a.userId, now: T })
        ).toEqual({ kind: "not_found" });
        expect(await feedbackOf(trx, emailId)).toEqual([]);
      }
      expect((await getEmailFlags(trx, { orgId: a.orgId }, touched))?.answeredCheck).toBeNull();
    });
  });

  test("2. yes: the answer and one needs_reply label in one transaction; a second answer is 'already'", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await setup(trx);
      const id = await answeredMail(trx, a, "MAIL");
      const input = { emailId: id, answer: "yes" as const, userId: a.userId, now: T };

      expect(await answerAnsweredCheck(trx, { orgId: a.orgId }, input)).toEqual({ kind: "yes" });

      expect(await getEmailFlags(trx, { orgId: a.orgId }, id)).toMatchObject({ answeredCheck: "yes" });
      expect(await feedbackOf(trx, id)).toMatchObject([
        { source: "answered_check", verdict: "wrong", true_category: "needs_reply", user_id: a.userId },
      ]);
      expect(await answerAnsweredCheck(trx, { orgId: a.orgId }, input)).toEqual({ kind: "already" });
      expect(await feedbackOf(trx, id)).toHaveLength(1);
      expect(await candidates(trx, a)).toEqual([]);
    });
  });

  test("3. no: only the answer; a later yes is 'already'", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await setup(trx);
      const id = await answeredMail(trx, a, "MAIL");
      const input = { emailId: id, userId: a.userId, now: T };

      expect(await answerAnsweredCheck(trx, { orgId: a.orgId }, { ...input, answer: "no" })).toEqual({ kind: "no" });

      expect(await getEmailFlags(trx, { orgId: a.orgId }, id)).toMatchObject({ answeredCheck: "no" });
      expect(await feedbackOf(trx, id)).toEqual([]);
      expect(await answerAnsweredCheck(trx, { orgId: a.orgId }, { ...input, answer: "yes" })).toEqual({
        kind: "already",
      });
      expect(await feedbackOf(trx, id)).toEqual([]);
    });
  });

  test("4. another organization's context gives not_found and writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await setup(trx);
      const id = await answeredMail(trx, a, "MAIL");

      const result = await answerAnsweredCheck(
        trx,
        { orgId: b.orgId },
        { emailId: id, answer: "yes", userId: b.userId, now: T }
      );

      expect(result).toEqual({ kind: "not_found" });
      expect(await getEmailFlags(trx, { orgId: a.orgId }, id)).toMatchObject({ answeredCheck: null });
      expect(await feedbackOf(trx, id)).toEqual([]);
    });
  });

  test("5. /review with both flags on and 2 candidates: one message with the page and the block; flag off: no block", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      await flagsOn(trx, a.orgId, ["review_command"]);
      await answeredMail(trx, a, "ANSWERED-ONE", { ageMs: 2 * DAY });
      await answeredMail(trx, a, "ANSWERED-TWO", { category: "notification", ageMs: DAY });
      const plain = await reviewMessage(commandDeps(trx), link);
      expect(plain.text).not.toContain("You replied to");
      expect(plain.buttons.flat().some((button) => /^a[yn]:/.test(button.data))).toBe(false);

      await flagsOn(trx, a.orgId, ["answered_check"]);
      const message = await reviewMessage(commandDeps(trx), link);

      expect(message.text).toContain("Review: ");
      expect(message.text).toContain("You replied to 2 mails");
      const data = message.buttons.flat().map((button) => button.data);
      expect(data.filter((item) => item.startsWith("ay:"))).toHaveLength(2);
      expect(data.filter((item) => item.startsWith("an:"))).toHaveLength(2);
    });
  });

  test("5b. review_command off: the off text, no block, even with answered_check on", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      await flagsOn(trx, a.orgId, ["answered_check"]);
      await answeredMail(trx, a, "ANSWERED");
      expect(await reviewMessage(commandDeps(trx), link)).toEqual({
        text: "This command is not on for your account.",
        buttons: [],
      });
    });
  });

  test("6. taps: flag off (also FEATURES_OFF) writes nothing; flag on writes the yes answer and M1 reads the truth", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      const id = await answeredMail(trx, a, "MAIL");
      const deps = callbackDeps(trx);

      expect(await handleCallback(deps, link, `ay:${id}`)).toEqual(OFF);
      expect(await handleCallback(deps, link, `an:${id}`)).toEqual(OFF);
      await flagsOn(trx, a.orgId, ["answered_check"]);
      configureFeatures({ off: ["answered_check"] });
      try {
        expect(await handleCallback(deps, link, `ay:${id}`)).toEqual(OFF);
      } finally {
        configureFeatures({ off: [] });
      }
      expect(await feedbackOf(trx, id)).toEqual([]);
      expect(await getEmailFlags(trx, { orgId: a.orgId }, id)).toMatchObject({ answeredCheck: null });

      expect(await handleCallback(deps, link, `ay:${id}`)).toEqual({ answer: "Saved: it needed a reply." });
      expect(await handleCallback(deps, link, `ay:${id}`)).toEqual({ answer: "Already answered." });
      expect(await feedbackOf(trx, id)).toHaveLength(1);

      const week = weekRange("2026-11-16", "Europe/Warsaw");
      const rows = await listTruthRows(trx, { orgId: a.orgId }, { range: week, mailboxId: null, testMail });
      expect(rows.find((row) => row.emailId === id)).toMatchObject({
        truth: "needs_reply",
        truthSource: "answered_check",
      });
    });
  });

  test("6b. a no tap and a foreign or unknown mail; any linked member may tap", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, link } = await setup(trx);
      await flagsOn(trx, a.orgId, ["answered_check"]);
      const id = await answeredMail(trx, a, "MAIL");
      const foreign = await answeredMail(trx, b, "FOREIGN");
      const assistant: LinkedChat = { ...link, role: "assistant" };
      const deps = callbackDeps(trx);

      expect(await handleCallback(deps, assistant, `an:${id}`)).toEqual({ answer: "Saved: no reply needed." });
      expect(await feedbackOf(trx, id)).toEqual([]);
      const notFound = { answer: "This mail is not in your account." };
      expect(await handleCallback(deps, link, `ay:${foreign}`)).toEqual(notFound);
      expect(await handleCallback(deps, link, `ay:00000000-0000-4000-8000-000000000000`)).toEqual(notFound);
      expect(await getEmailFlags(trx, { orgId: b.orgId }, foreign)).toMatchObject({ answeredCheck: null });
    });
  });
  test("7. a page tap first, then Yes: the answer is saved, the first label stays the only row, M1 counts it", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      await flagsOn(trx, a.orgId, ["answered_check"]);
      const id = await answeredMail(trx, a, "MAIL");
      const deps = callbackDeps(trx);

      expect((await handleCallback(deps, link, `vr:i:${id}`)).answer).toContain("Saved");
      expect(await handleCallback(deps, link, `ay:${id}`)).toEqual({ answer: "Saved: it needed a reply." });

      expect(await feedbackOf(trx, id)).toMatchObject([{ source: "review", verdict: "right", true_category: "info" }]);
      expect(await getEmailFlags(trx, { orgId: a.orgId }, id)).toMatchObject({ answeredCheck: "yes" });
      expect(await candidates(trx, a)).toEqual([]);
      expect(await truthOf(trx, a, id)).toMatchObject({ truth: "info", truthSource: "review" });
    });
  });

  test("8. Yes first, then a stale page tap: the page tap path is unchanged, the latest row wins in M1", async () => {
    await withRollback(db, async (trx) => {
      const { a, link } = await setup(trx);
      await flagsOn(trx, a.orgId, ["answered_check"]);
      const id = await answeredMail(trx, a, "MAIL");
      const deps = callbackDeps(trx);

      await handleCallback(deps, link, `ay:${id}`);
      // Rows of one transaction share `now()`: move the first row into the past so the next one is the newest.
      await trx
        .updateTable("triage_feedback")
        .set({ created_at: sql`created_at - interval '1 minute'` })
        .execute();
      await handleCallback(deps, link, `vr:i:${id}`);

      const rows = await feedbackOf(trx, id);
      expect(rows.map((row) => row.source).sort()).toEqual(["answered_check", "review"]);
      expect(await truthOf(trx, a, id)).toMatchObject({ truth: "info", truthSource: "review" });
    });
  });

  test("9. setAnsweredCheck writes only on a row of a real read that says answered, and only once", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await setup(trx);
      const ctx = { orgId: a.orgId };
      const input = { answer: "yes" as const, userId: a.userId, at: T };
      const touched = await mail(trx, a, "TOUCHED");
      const row = await trx
        .selectFrom("emails")
        .select(["folder", "uid", "received_at"])
        .where("id", "=", touched)
        .executeTakeFirstOrThrow();
      const target = {
        emailId: touched,
        folder: row.folder,
        uid: Number(row.uid),
        messageId: null,
        receivedAt: row.received_at,
      };
      await touchEmailFlags(trx, ctx, [target], T);
      const answered = await answeredMail(trx, a, "ANSWERED");

      expect(await setAnsweredCheck(trx, ctx, touched, input)).toBe(false);
      expect(await getEmailFlags(trx, ctx, touched)).toMatchObject({ answered: false, answeredCheck: null });
      expect(await setAnsweredCheck(trx, ctx, answered, input)).toBe(true);
      expect(await setAnsweredCheck(trx, ctx, answered, { ...input, answer: "no" })).toBe(false);
      expect(await getEmailFlags(trx, ctx, answered)).toMatchObject({ answeredCheck: "yes" });
    });
  });
});
