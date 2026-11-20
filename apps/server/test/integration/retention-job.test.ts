import { randomUUID } from "node:crypto";
import { format } from "node:util";

import { DAY_MS, HOUR_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { clearMailBodies, clearSentBodies, clearSentHeaders } from "../../src/modules/mail";
import { listOrganizations } from "../../src/modules/tenancy";
import { deleteExpiredVerifications } from "../../src/platform/auth";
import type { DB } from "../../src/platform/db";
import { createRetentionJob, type Clearers, type RetentionCounts } from "../../src/retention";

import {
  createOrgWithMailbox,
  insertAction,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTestEmail,
  insertTriaged,
  suspendOrg,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopRow } from "./loops-fixtures";
import { insertReplyRequest } from "./reply-fixtures";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-12T02:40:00Z");
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const over90 = ago(90 * DAY_MS + 1000);

// `log.info` writes to console.log; `log.warn` and `log.error` write to console.error.
let lines: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  lines = [];
  logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(format(...args));
  });
  errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(format(...args));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

interface Org {
  orgId: string;
  userId: string;
  mailboxId: string;
}

async function newOrg(trx: Transaction<DB>, retentionDays: number, suspended = false): Promise<Org> {
  const org = await createOrgWithMailbox(trx);
  await trx
    .updateTable("organizations")
    .set({ data_retention_days: retentionDays })
    .where("id", "=", org.orgId)
    .execute();
  if (suspended) await suspendOrg(trx, org.orgId);
  return org;
}

async function body(trx: Transaction<DB>, id: string): Promise<string | null> {
  return (await trx.selectFrom("emails").select("body_text").where("id", "=", id).executeTakeFirstOrThrow()).body_text;
}

const doneMail = (trx: Transaction<DB>, org: Org, age: number) =>
  insertTestEmail(trx, { orgId: org.orgId }, org.mailboxId, {
    status: "done",
    created_at: ago(age),
    body_text: "Body text",
  });

describe("retention job: run", () => {
  test("clears the bodies by the retention days of each organization, for every plan", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx, 30);
      const b = await newOrg(trx, 7);
      const c = await newOrg(trx, 30, true);
      const rows = {
        a10: await doneMail(trx, a, 10 * DAY_MS),
        a40: await doneMail(trx, a, 40 * DAY_MS),
        b10: await doneMail(trx, b, 10 * DAY_MS),
        b40: await doneMail(trx, b, 40 * DAY_MS),
        c10: await doneMail(trx, c, 10 * DAY_MS),
        c40: await doneMail(trx, c, 40 * DAY_MS),
      };

      await createRetentionJob({ db: trx, now: () => NOW }).run();

      expect(await body(trx, rows.a10)).toBe("Body text");
      expect(await body(trx, rows.a40)).toBeNull();
      expect(await body(trx, rows.b10)).toBeNull();
      expect(await body(trx, rows.b40)).toBeNull();
      expect(await body(trx, rows.c10)).toBe("Body text");
      expect(await body(trx, rows.c40)).toBeNull();
      expect(lines.some((line) => /^\[retention\] retention_done .*org_count=\d+ count=\d+$/.test(line))).toBe(true);
      expect(lines.join("\n")).not.toContain("dropped_fields");
    });
  });
});

async function insertCaptured(trx: Transaction<DB>, orgId: string, emailId: string, text: string, capturedAt: Date) {
  await trx
    .insertInto("email_headers")
    .values({
      email_id: emailId,
      org_id: orgId,
      from_name: text,
      reply_to: [`${text}@x.test`],
      parts_known: true,
      captured_at: capturedAt,
    })
    .execute();
}

// A stored Sent row with a text, a subject and addresses; `text` is the canary of the log test.
async function insertSentRow(trx: Transaction<DB>, org: Org, text: string, internalDate: Date): Promise<void> {
  await trx
    .insertInto("sent_emails")
    .values({
      org_id: org.orgId,
      mailbox_id: org.mailboxId,
      dedup_key: `sent:${randomUUID()}`,
      path: "Sent",
      uidvalidity: "1",
      uid: String(Math.floor(Math.random() * 1_000_000)),
      thread_key: `sent-thread-${randomUUID()}`,
      from_address: `${text}@x.test`,
      to_addresses: [`${text}@x.test`],
      subject: text,
      body_text: text,
      origin: "user",
      content: "stored",
      sent_at: internalDate,
      internal_date: internalDate,
    })
    .execute();
}

// One row per kind of the retention list, all over 90 days (the mail body is over the 30 days of the organization).
async function seedFullSet(trx: Transaction<DB>, org: Org, text: string) {
  const ctx = { orgId: org.orgId };
  const old = await insertTestEmail(trx, ctx, org.mailboxId, {
    status: "done",
    created_at: over90,
    body_text: text,
    subject: text,
    from_address: `${text}@x.test`,
  });
  // The mail of the other rows is new: its own body and headers stay.
  const fresh = await insertTestEmail(trx, ctx, org.mailboxId, { status: "done", created_at: ago(DAY_MS) });
  await insertSentRow(trx, org, text, over90);
  await insertSentRow(trx, org, "fresh", ago(DAY_MS));
  // The captured texts of the old mail are over the 30 days of the organization; those of the fresh mail are not.
  await insertCaptured(trx, org.orgId, old, text, ago(31 * DAY_MS));
  await insertCaptured(trx, org.orgId, fresh, text, ago(DAY_MS));
  await insertTriaged(trx, ctx, org.mailboxId, {
    category: "info",
    createdAt: over90,
    reason: text,
    fields: { a: text },
  });
  await insertAction(trx, ctx, fresh, {
    type: "save_summary",
    status: "applied",
    createdAt: over90,
    payload: { text },
  });
  const failedMove = await insertAction(trx, ctx, fresh, { type: "move", status: "failed", createdAt: over90 });
  await trx.updateTable("actions").set({ last_error: text, updated_at: over90 }).where("id", "=", failedMove).execute();
  const delegateId = await insertDelegate(trx, ctx);
  const pair = await insertDraftAndSend(trx, ctx, org.mailboxId, { delegateId });
  const delegationId = await insertDelegation(trx, ctx, {
    mailboxId: org.mailboxId,
    emailId: pair.emailId,
    delegateId,
    draftActionId: pair.draftId,
    sendActionId: pair.sendId,
    status: "done",
    taskSummary: text,
  });
  await trx.updateTable("delegations").set({ updated_at: over90 }).where("id", "=", delegationId).execute();
  await trx
    .insertInto("outbox")
    .values({
      org_id: org.orgId,
      user_id: org.userId,
      kind: "sync_ok",
      dedup_key: `key-${randomUUID()}`,
      mailbox_id: org.mailboxId,
      text,
      buttons: "[]",
      status: "sent",
      created_at: over90,
      next_attempt_at: over90,
      sent_at: over90,
    })
    .execute();
  // A loop closed over 90 days ago: its subject, ask and addresses go.
  await insertLoopRow(trx, org, org.mailboxId, {
    status: "closed",
    close_reason: "replied",
    closed_at: over90,
    subject: text,
    text,
  });
  // A reply request made over 90 days ago: its instruction and sample text go; the row stays.
  await insertReplyRequest(trx, ctx, org.mailboxId, fresh, {
    trigger: "tap",
    instruction: text,
    sample_body: text,
    created_at: over90,
  });
  // A sender profile whose last mail is over 365 days old and an open suggestion over 30 days old: one row each.
  await trx
    .insertInto("sender_profiles")
    .values({
      org_id: org.orgId,
      mailbox_id: org.mailboxId,
      key_hash: randomUUID().replaceAll("-", "").repeat(2),
      relation: "known",
      last_seen_at: new Date(NOW.getTime() - 400 * DAY_MS),
    })
    .execute();
  await trx
    .insertInto("sender_suggestions")
    .values({
      org_id: org.orgId,
      mailbox_id: org.mailboxId,
      key_hash: randomUUID().replaceAll("-", "").repeat(2),
      scope: "address",
      kind: "vip",
      pattern: "never-logged@x.test",
      created_at: new Date(NOW.getTime() - 40 * DAY_MS),
    })
    .execute();
  await trx
    .insertInto("chat_link_tokens")
    .values({
      org_id: org.orgId,
      user_id: org.userId,
      token_hash: `${randomUUID()}${randomUUID()}`.replaceAll("-", ""),
      expires_at: ago(2 * DAY_MS),
    })
    .execute();
  return old;
}

const ZERO: RetentionCounts = {
  body: 0,
  headers: 0,
  sentBody: 0,
  sentHeaders: 0,
  capturedHeaders: 0,
  triage: 0,
  payloads: 0,
  errors: 0,
  tasks: 0,
  outbox: 0,
  loops: 0,
  replyTexts: 0,
  tokens: 0,
  profiles: 0,
  suggestions: 0,
};

describe("retention job: runOrg", () => {
  test("a full row set gives 1 in every count; the second run gives 0 in every count", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx, 30);
      await seedFullSet(trx, a, "secret");
      const job = createRetentionJob({ db: trx, now: () => NOW });
      const org = { id: a.orgId, dataRetentionDays: 30 };

      expect(await job.runOrg(org, NOW)).toEqual({
        body: 1,
        headers: 1,
        sentBody: 1,
        sentHeaders: 1,
        capturedHeaders: 1,
        triage: 1,
        payloads: 1,
        errors: 1,
        tasks: 1,
        outbox: 1,
        loops: 1,
        replyTexts: 1,
        tokens: 1,
        profiles: 1,
        suggestions: 1,
      });
      expect(await job.runOrg(org, NOW)).toEqual(ZERO);
    });
  });

  test("a sent row loses its text after the organization's period and its subject and addresses after 90 days", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx, 7);
      await insertSentRow(trx, a, "ten", ago(10 * DAY_MS));
      await insertSentRow(trx, a, "forty", ago(40 * DAY_MS));
      const job = createRetentionJob({ db: trx, now: () => NOW });
      const state = () =>
        trx
          .selectFrom("sent_emails")
          .select(["subject", "body_text", "content"])
          .where("org_id", "=", a.orgId)
          .orderBy("internal_date", "desc")
          .execute();

      const counts = await job.runOrg({ id: a.orgId, dataRetentionDays: 7 }, NOW);

      expect(counts).toEqual({ ...ZERO, sentBody: 2 });
      expect(await state()).toEqual([
        { subject: "ten", body_text: null, content: "stored" },
        { subject: "forty", body_text: null, content: "stored" },
      ]);

      const later = new Date(NOW.getTime() + 60 * DAY_MS);
      expect(await job.runOrg({ id: a.orgId, dataRetentionDays: 7 }, later)).toEqual({ ...ZERO, sentHeaders: 1 });
      expect(await state()).toEqual([
        { subject: "ten", body_text: null, content: "stored" },
        { subject: null, body_text: null, content: "stored" },
      ]);
    });
  });

  test("clears the captured texts of a row older than the organization's period and keeps a newer row", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx, 30);
      await seedFullSet(trx, a, "secret");
      const rows = () =>
        trx
          .selectFrom("email_headers")
          .select(["from_name", "texts_cleared_at"])
          .where("org_id", "=", a.orgId)
          .orderBy("captured_at")
          .execute();

      const counts = await createRetentionJob({ db: trx, now: () => NOW }).runOrg(
        { id: a.orgId, dataRetentionDays: 30 },
        NOW
      );

      expect(counts.capturedHeaders).toBe(1);
      const [cleared, kept] = await rows();
      expect(cleared?.from_name).toBeNull();
      expect(cleared?.texts_cleared_at).not.toBeNull();
      expect(kept?.from_name).toBe("secret");
      expect(kept?.texts_cleared_at).toBeNull();
    });
  });

  test("a loop closed 60 days ago keeps its texts although the organization period is 30 days", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx, 30);
      const id = await insertLoopRow(trx, a, a.mailboxId, {
        status: "closed",
        close_reason: "replied",
        closed_at: ago(60 * DAY_MS),
      });

      const counts = await createRetentionJob({ db: trx, now: () => NOW }).runOrg(
        { id: a.orgId, dataRetentionDays: 30 },
        NOW
      );

      expect(counts.loops).toBe(0);
      const row = await trx.selectFrom("open_loops").select("subject").where("id", "=", id).executeTakeFirstOrThrow();
      expect(row.subject).not.toBeNull();
    });
  });

  test("keeps the applied draft payload of an open delegation; clears the one of a closed delegation", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx, 30);
      const ctx = { orgId: a.orgId };
      async function draftOf(status: string): Promise<string> {
        const delegateId = await insertDelegate(trx, ctx);
        const { emailId, draftId, sendId } = await insertDraftAndSend(trx, ctx, a.mailboxId, {
          delegateId,
          createdAt: over90,
          dueDate: "2027-03-01",
          language: "pl",
        });
        await insertDelegation(trx, ctx, {
          mailboxId: a.mailboxId,
          emailId,
          delegateId,
          draftActionId: draftId,
          sendActionId: sendId,
          status,
          remindersSent: 0,
        });
        return draftId;
      }
      const sent = await draftOf("sent");
      const done = await draftOf("done");

      await createRetentionJob({ db: trx, now: () => NOW }).runOrg({ id: a.orgId, dataRetentionDays: 30 }, NOW);

      const read = async (id: string) =>
        (await trx.selectFrom("actions").select("payload").where("id", "=", id).executeTakeFirstOrThrow()).payload;
      expect(await read(sent)).toMatchObject({ due_date: "2027-03-01", language: "pl" });
      expect(await read(done)).toEqual({});
    });
  });
});

// The job reads no mailbox status, plan or triage scope. Scope `off` means the triage worker does not run,
// so for the retention job it is the same as a stuck mail in a mailbox that no worker visits. Each §7 row, with the
// stuck `processing` mail and the stuck `applying` payload, must clear in every state; open work must stay.
describe("retention job: every §7 row in a paused mailbox, a suspended organization and with triage off", () => {
  const variants: { name: string; paused: boolean; suspended: boolean }[] = [
    { name: "paused mailbox", paused: true, suspended: false },
    { name: "suspended organization", paused: false, suspended: true },
    { name: "triage off: active mailbox, active organization, no worker run", paused: false, suspended: false },
    { name: "paused mailbox of a suspended organization", paused: true, suspended: true },
  ];

  for (const variant of variants) {
    test(variant.name, async () => {
      await withRollback(db, async (trx) => {
        const a = await newOrg(trx, 30, variant.suspended);
        if (variant.paused) {
          await trx.updateTable("mailboxes").set({ status: "paused" }).where("id", "=", a.mailboxId).execute();
        }
        const ctx = { orgId: a.orgId };
        const text = "secret";
        const mail = (created: Date, extra: Record<string, unknown> = {}) =>
          insertTestEmail(trx, ctx, a.mailboxId, { created_at: created, body_text: text, ...extra });
        const doneOld = await mail(over90, { status: "done", subject: text, from_address: `${text}@x.test` });
        const pendingOld = await mail(ago(40 * DAY_MS), { status: "pending" });
        const stuckProcessing = await mail(ago(40 * DAY_MS), { status: "processing", locked_at: ago(40 * DAY_MS) });
        const youngProcessing = await mail(ago(40 * DAY_MS), { status: "processing", locked_at: ago(DAY_MS) });
        const fresh = await insertTestEmail(trx, ctx, a.mailboxId, { status: "done", created_at: ago(DAY_MS) });
        await insertCaptured(trx, a.orgId, doneOld, text, ago(31 * DAY_MS));
        await insertTriaged(trx, ctx, a.mailboxId, { category: "info", createdAt: over90, reason: text });
        await insertAction(trx, ctx, fresh, {
          type: "save_summary",
          status: "applied",
          createdAt: over90,
          payload: { text },
        });
        const stuckSend = await insertAction(trx, ctx, fresh, {
          type: "send",
          status: "applying",
          createdAt: over90,
          lockedAt: over90,
          approvedAt: over90,
          payload: { text },
        });
        await trx.updateTable("actions").set({ updated_at: over90 }).where("id", "=", stuckSend).execute();
        const failedMove = await insertAction(trx, ctx, fresh, { type: "move", status: "failed", createdAt: over90 });
        await trx
          .updateTable("actions")
          .set({ last_error: text, updated_at: over90 })
          .where("id", "=", failedMove)
          .execute();
        const delegations: Record<string, string> = {};
        for (const status of ["done", "sent"]) {
          const delegateId = await insertDelegate(trx, ctx);
          const pair = await insertDraftAndSend(trx, ctx, a.mailboxId, { delegateId, createdAt: ago(DAY_MS) });
          delegations[status] = await insertDelegation(trx, ctx, {
            mailboxId: a.mailboxId,
            emailId: pair.emailId,
            delegateId,
            draftActionId: pair.draftId,
            sendActionId: pair.sendId,
            status,
            taskSummary: text,
          });
          await trx
            .updateTable("delegations")
            .set({ updated_at: over90 })
            .where("id", "=", delegations[status] ?? "")
            .execute();
        }
        await trx
          .insertInto("outbox")
          .values({
            org_id: a.orgId,
            user_id: a.userId,
            kind: "sync_ok",
            dedup_key: `key-${randomUUID()}`,
            mailbox_id: a.mailboxId,
            text,
            buttons: "[]",
            status: "sent",
            created_at: over90,
            next_attempt_at: over90,
            sent_at: over90,
          })
          .execute();
        await trx
          .insertInto("chat_link_tokens")
          .values({
            org_id: a.orgId,
            user_id: a.userId,
            token_hash: `${randomUUID()}${randomUUID()}`.replaceAll("-", ""),
            expires_at: ago(2 * DAY_MS),
          })
          .execute();

        // The sender context ages out in every variant: a profile with its last mail 400 days ago, and an open suggestion 40
        // days old (it ends as `expired`). The plan and the mailbox status decide nothing here.
        await trx
          .insertInto("sender_profiles")
          .values({
            org_id: a.orgId,
            mailbox_id: a.mailboxId,
            key_hash: randomUUID().replaceAll("-", "").repeat(2),
            relation: "known",
            last_seen_at: new Date(NOW.getTime() - 400 * DAY_MS),
          })
          .execute();
        await trx
          .insertInto("sender_suggestions")
          .values({
            org_id: a.orgId,
            mailbox_id: a.mailboxId,
            key_hash: randomUUID().replaceAll("-", "").repeat(2),
            scope: "address",
            kind: "vip",
            pattern: "never-logged@x.test",
            created_at: new Date(NOW.getTime() - 40 * DAY_MS),
          })
          .execute();

        const job = createRetentionJob({ db: trx, now: () => NOW });
        const org = { id: a.orgId, dataRetentionDays: 30 };

        expect(await job.runOrg(org, NOW)).toEqual({
          body: 3,
          headers: 1,
          sentBody: 0,
          sentHeaders: 0,
          capturedHeaders: 1,
          triage: 1,
          payloads: 2,
          errors: 1,
          tasks: 1,
          outbox: 1,
          loops: 0,
          replyTexts: 0,
          tokens: 1,
          profiles: 1,
          suggestions: 1,
        });
        expect(await body(trx, doneOld)).toBeNull();
        expect(await body(trx, pendingOld)).toBeNull();
        expect(await body(trx, stuckProcessing)).toBeNull();
        expect(await body(trx, youngProcessing)).toBe(text);
        const task = async (id: string) =>
          (await trx.selectFrom("delegations").select("task_summary").where("id", "=", id).executeTakeFirstOrThrow())
            .task_summary;
        expect(await task(delegations.done ?? "")).toBe("[removed]");
        expect(await task(delegations.sent ?? "")).toBe(text);
        expect(await job.runOrg(org, NOW)).toEqual(ZERO);
      });
    });
  }
});

describe("retention job: log", () => {
  test("the lines hold counts and the organization id; no subject, address or body text", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx, 30);
      const old = await seedFullSet(trx, a, "TopSecretText");

      await createRetentionJob({ db: trx, now: () => NOW }).run();

      expect(await body(trx, old)).toBeNull();
      const joined = lines.join("\n");
      const done = lines.filter((line) => line.includes("retention_org_done") && line.includes(a.orgId));
      expect(done).toHaveLength(1);
      for (const key of [
        "body_rows",
        "header_rows",
        "sent_body_rows",
        "sent_header_rows",
        "captured_header_rows",
        "triage_rows",
        "payload_rows",
        "error_rows",
        "task_rows",
        "outbox_rows",
        "loop_rows",
        "reply_text_rows",
        "token_rows",
        "profile_rows",
        "suggestion_rows",
      ]) {
        expect(done[0]).toContain(`${key}=1`);
      }
      expect(joined).not.toContain("dropped_fields");
      expect(joined).not.toContain("TopSecretText");
      expect(joined).not.toContain("@x.test");
      expect(joined).not.toContain("never-logged");
      expect(joined).not.toContain(old);
    });
  });
});

describe("retention job: an error in one organization", () => {
  test("run() resolves, logs one error line for the first organization and clears the second", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx, 30);
      const b = await newOrg(trx, 30);
      const mine = new Set([a.orgId, b.orgId]);
      const first = (await listOrganizations(trx)).find((org) => mine.has(org.id));
      expect(first).toBeDefined();
      const firstOrg = first?.id === a.orgId ? a : b;
      const secondOrg = firstOrg === a ? b : a;
      const firstMail = await doneMail(trx, firstOrg, 40 * DAY_MS);
      const secondMail = await doneMail(trx, secondOrg, 40 * DAY_MS);

      const job = createRetentionJob({
        db: trx,
        now: () => NOW,
        clearers: {
          clearMailBodies: async (dbOrTrx, ctx, opts) => {
            if (ctx.orgId === firstOrg.orgId) throw new Error("boom");
            return clearMailBodies(dbOrTrx, ctx, opts);
          },
        },
      });
      await job.run();

      expect(
        lines.filter((line) => line.includes("retention_org_failed") && line.includes(firstOrg.orgId))
      ).toHaveLength(1);
      expect(lines.join("\n")).not.toContain("dropped_fields");
      expect(lines.filter((line) => line.includes("retention_org_failed"))[0]).toContain("error=Error");
      expect(await body(trx, firstMail)).toBe("Body text");
      expect(await body(trx, secondMail)).toBeNull();
    });
  });
});

describe("retention job: a failed organization list", () => {
  test("run() resolves and writes retention_failed with the error name only", async () => {
    const failing = new Proxy(db, {
      get(target, property) {
        if (property === "selectFrom") {
          return () => {
            throw new Error("CanaryText failed@x.test");
          };
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });

    await createRetentionJob({ db: failing, now: () => NOW }).run();

    const failed = lines.filter((line) => line.includes("retention_failed"));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("error=Error");
    const joined = lines.join("\n");
    expect(joined).not.toContain("dropped_fields");
    expect(joined).not.toContain("CanaryText");
    expect(joined).not.toContain("@x.test");
  });
});

describe("retention job: an error in a Sent clear function", () => {
  const failing = (name: string, failOrg: string): Partial<Clearers> => {
    const fail = (original: typeof clearSentBodies): typeof clearSentBodies => {
      return async (dbOrTrx, ctx, opts) => {
        if (ctx.orgId === failOrg) throw new Error("CanaryText failed@x.test");
        return original(dbOrTrx, ctx, opts);
      };
    };
    return name === "clearSentBodies"
      ? { clearSentBodies: fail(clearSentBodies) }
      : { clearSentHeaders: fail(clearSentHeaders) };
  };
  for (const name of ["clearSentBodies", "clearSentHeaders"]) {
    test(`${name} fails with mail text in its message: the log holds the error name only; the next organization runs`, async () => {
      await withRollback(db, async (trx) => {
        const a = await newOrg(trx, 30);
        const b = await newOrg(trx, 30);
        const mine = new Set([a.orgId, b.orgId]);
        const first = (await listOrganizations(trx)).find((org) => mine.has(org.id));
        const firstOrg = first?.id === a.orgId ? a : b;
        const secondOrg = firstOrg === a ? b : a;
        await insertSentRow(trx, firstOrg, "CanaryText", over90);
        await insertSentRow(trx, secondOrg, "OtherText", over90);

        await createRetentionJob({
          db: trx,
          now: () => NOW,
          clearers: failing(name, firstOrg.orgId),
        }).run();

        const joined = lines.join("\n");
        expect(
          lines.filter((line) => line.includes("retention_org_failed") && line.includes(firstOrg.orgId))
        ).toHaveLength(1);
        expect(joined).not.toContain("dropped_fields");
        expect(joined).not.toContain("CanaryText");
        expect(joined).not.toContain("OtherText");
        expect(joined).not.toContain("@x.test");
        expect(joined).not.toContain("never-logged");
        const rows = await trx
          .selectFrom("sent_emails")
          .select(["body_text", "subject"])
          .where("org_id", "=", secondOrg.orgId)
          .execute();
        expect(rows).toEqual([{ body_text: null, subject: null }]);
      });
    });
  }
});

describe("retention job: auth_verifications", () => {
  async function insertVerification(trx: Transaction<DB>, tag: string, expiresAt: Date): Promise<void> {
    await trx
      .insertInto("auth_verifications")
      .values({ identifier: `hash-${tag}`, value: `user-${tag}`, expires_at: expiresAt })
      .execute();
  }

  async function tagsLeft(trx: Transaction<DB>, tags: string[]): Promise<string[]> {
    const rows = await trx
      .selectFrom("auth_verifications")
      .select("identifier")
      .where(
        "identifier",
        "in",
        tags.map((tag) => `hash-${tag}`)
      )
      .orderBy("identifier")
      .execute();
    return rows.map((row) => row.identifier.slice("hash-".length));
  }

  test("deletes a row that expired over a day ago, keeps a row in the grace period and a live row; a second run changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const tags = ["Secret1expired", "Secret2grace", "Secret3live"];
      await insertVerification(trx, tags[0] ?? "", ago(25 * HOUR_MS));
      await insertVerification(trx, tags[1] ?? "", ago(23 * HOUR_MS));
      await insertVerification(trx, tags[2] ?? "", new Date(NOW.getTime() + HOUR_MS));

      await createRetentionJob({ db: trx, now: () => NOW }).run();

      expect(await tagsLeft(trx, tags)).toEqual(["Secret2grace", "Secret3live"]);
      const countLines = lines.filter((line) => line.includes("retention_auth_verifications_deleted"));
      expect(countLines).toHaveLength(1);
      expect(countLines[0]).toMatch(/count=\d+|"count":\d+/);
      const joined = lines.join("\n");
      expect(joined).not.toContain("Secret");
      expect(joined).not.toContain("hash-");
      expect(joined).not.toContain("user-");

      lines.length = 0;
      await createRetentionJob({ db: trx, now: () => NOW }).run();

      expect(await tagsLeft(trx, tags)).toEqual(["Secret2grace", "Secret3live"]);
      expect(lines.some((line) => line.includes("retention_auth_verifications_deleted"))).toBe(false);
      expect(await deleteExpiredVerifications(trx, { before: ago(DAY_MS) })).toBe(0);
    });
  });

  test("an error in the delete is logged by code; the organizations still run", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx, 30);
      const mail = await doneMail(trx, a, 40 * DAY_MS);

      await createRetentionJob({
        db: trx,
        now: () => NOW,
        clearers: {
          deleteExpiredVerifications: async () => {
            throw new Error("secret-token-text");
          },
        },
      }).run();

      expect(lines.filter((line) => line.includes("retention_auth_verifications_failed"))).toHaveLength(1);
      expect(lines.join("\n")).not.toContain("secret-token-text");
      expect(await body(trx, mail)).toBeNull();
    });
  });
});
