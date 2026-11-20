import { randomBytes } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { isOwnActionId } from "../../src/modules/actions";
import { auditEvents } from "../../src/modules/audit";
import { insertDefaultSettings } from "../../src/modules/config";
import {
  backfillInbox,
  backfillMailbox,
  MailAuthError,
  NO_TEST_SENDERS,
  syncMailbox,
  type BackfillRefusal,
  type HistoryBackfillOutcome,
  type MailProvider,
  type OAuthTokens,
  type SeedMessage,
  type SyncDeps,
} from "../../src/modules/mail";
import { createFakeMailProvider } from "../../src/modules/mail/fake";
import { protocolDisabled } from "../../src/modules/mail/oauth/login";
import { insertCredentials, updateCursor } from "../../src/modules/mail/repo";
import { buildDigestMessage } from "../../src/modules/reports";
import { createLlmPause, createTriageJob, noGateEvidence } from "../../src/modules/triage";
import { requeueBackfillWindow } from "../../src/modules/triage";
import { createSecretBox } from "../../src/platform/crypto";
import type { DB, Db, TenantContext } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";
import type { LlmClient } from "../../src/platform/llm";

import { createOrgWithMailbox, pauseOtherMailboxes, suspendOrg } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The history check of the trust ladder, step 1: the INBOX backfill in the `history` purpose. The mail is stored for the history check and never reaches triage.
// The provider is the in-memory fake (no mailbox, no LLM call).
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const UID_VALIDITY = 7;
const NOW = new Date("2026-11-03T12:00:00Z");
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SINCE_DAYS = 30;
const secrets = createSecretBox(randomBytes(32).toString("base64"), 1);

const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

function seed(n: number): SeedMessage {
  return {
    messageId: `<h${n}@x.test>`,
    from: `sender${n}@x.test`,
    to: ["box@x.test"],
    subject: `Mail ${n}`,
    date: NOW,
    text: `Body ${n}`,
  };
}

function deps(trx: Db | Transaction<DB>, provider: MailProvider): SyncDeps {
  return { db: trx, provider, isOwnActionId: async () => false, now: () => NOW };
}

// Mailbox with a synced INBOX: h1 (40 days old, outside the window), h2 (20 days), h3 (10 days), h4 (2 hours; the initial sync stores it).
async function syncedMailbox(trx: Transaction<DB>) {
  const { orgId, mailboxId, userId } = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId };
  const fake = createFakeMailProvider({ uidValidity: UID_VALIDITY });
  fake.deliver("INBOX", seed(1), { internalDate: ago(40 * DAY_MS) });
  fake.deliver("INBOX", seed(2), { internalDate: ago(20 * DAY_MS) });
  fake.deliver("INBOX", seed(3), { internalDate: ago(10 * DAY_MS) });
  fake.deliver("INBOX", seed(4), { internalDate: ago(2 * HOUR_MS) });
  const initial = await syncMailbox(deps(trx, fake), ctx, mailboxId);
  expect(initial.stored).toBe(1);
  return { ctx, mailboxId, userId, fake };
}

async function rowsOf(trx: Db | Transaction<DB>, mailboxId: string) {
  return trx
    .selectFrom("emails")
    .selectAll()
    .where("mailbox_id", "=", mailboxId)
    .orderBy("message_id_header")
    .execute();
}

const byId = <T extends { message_id_header: string | null }>(rows: T[], n: number): T => {
  const row = rows.find((candidate) => candidate.message_id_header === `<h${n}@x.test>`);
  if (row === undefined) throw new Error(`no row for h${n}`);
  return row;
};

async function headerCount(trx: Db | Transaction<DB>, mailboxId: string): Promise<number> {
  const rows = await trx
    .selectFrom("email_headers")
    .innerJoin("emails", "emails.id", "email_headers.email_id")
    .select("email_headers.email_id")
    .where("emails.mailbox_id", "=", mailboxId)
    .execute();
  return rows.length;
}

async function cursorOf(trx: Db | Transaction<DB>, mailboxId: string) {
  return trx
    .selectFrom("mailboxes")
    .select(["uidvalidity", "last_uid"])
    .where("id", "=", mailboxId)
    .executeTakeFirstOrThrow();
}

// The stored mail h4 is `triaged` and carries a wrong UID: a normal backfill would repair the UID (`update_uid`); the history run must not.
async function triagedH4(trx: Transaction<DB>, mailboxId: string): Promise<void> {
  await trx
    .updateTable("emails")
    .set({ status: "triaged", uid: 99, source_uid: 99 })
    .where("mailbox_id", "=", mailboxId)
    .where("message_id_header", "=", "<h4@x.test>")
    .execute();
}

const sinceOf = (days = SINCE_DAYS) => ago(days * DAY_MS);

describe("history purpose: backfillInbox", () => {
  test("1. stores the missing mails as skipped/history_check with backfilled_at and headers; the triaged mail is unchanged; the cursor stays", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await triagedH4(trx, s.mailboxId);
      const before = await rowsOf(trx, s.mailboxId);
      const cursor = await cursorOf(trx, s.mailboxId);
      expect(await headerCount(trx, s.mailboxId)).toBe(1);

      const outcome = await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, {
        since: sinceOf(),
        purpose: "history",
      });

      expect(outcome.kind).toBe("done");
      if (outcome.kind !== "done") return;
      expect(outcome.result).toMatchObject({ fetched: 3, stored: 2, uidUpdated: 0, returned: 0, relocated: 0 });
      const after = await rowsOf(trx, s.mailboxId);
      expect(after).toHaveLength(3);
      for (const n of [2, 3]) {
        const row = byId(after, n);
        expect(row.status).toBe("skipped");
        expect(row.skip_reason).toBe("history_check");
        expect(row.backfilled_at?.getTime()).toBe(NOW.getTime());
        expect(row.attempts).toBe(0);
        expect(row.locked_at).toBeNull();
      }
      // The mail of before is not touched: every column, including the wrong UID that sync owns.
      expect(JSON.stringify(byId(after, 4))).toBe(JSON.stringify(byId(before, 4)));
      expect(byId(after, 4)).toMatchObject({ status: "triaged", uid: "99", source_uid: "99", skip_reason: null });
      expect(byId(after, 4).backfilled_at).toBeNull();
      expect(await headerCount(trx, s.mailboxId)).toBe(3);
      expect(await cursorOf(trx, s.mailboxId)).toEqual(cursor);
      const readOnly = ["listFolders", "folderStatus", "fetchContent", "fetchMetaIn", "searchSinceIn", "fetchByUidsIn"];
      for (const call of s.fake.calls) expect(readOnly).toContain(call);
    });
  });

  test("2. a second history run stores nothing new", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: sinceOf(), purpose: "history" });
      const first = await rowsOf(trx, s.mailboxId);
      const again = await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, {
        since: sinceOf(),
        purpose: "history",
      });
      expect(again).toMatchObject({ kind: "done", result: { stored: 0 } });
      expect(JSON.stringify(await rowsOf(trx, s.mailboxId))).toBe(JSON.stringify(first));
      expect(await headerCount(trx, s.mailboxId)).toBe(3);
    });
  });

  test("a mail that exists in any status is not changed, and its history copy is not stored again", async () => {
    for (const status of ["pending", "processing", "triaged", "done", "skipped"] as const) {
      await withRollback(db, async (trx) => {
        const s = await syncedMailbox(trx);
        await trx
          .updateTable("emails")
          .set({ status, uid: 99, source_uid: 99, skip_reason: status === "skipped" ? "too_old" : null })
          .where("mailbox_id", "=", s.mailboxId)
          .where("message_id_header", "=", "<h4@x.test>")
          .execute();
        const before = byId(await rowsOf(trx, s.mailboxId), 4);
        await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: sinceOf(), purpose: "history" });
        expect(JSON.stringify(byId(await rowsOf(trx, s.mailboxId), 4))).toBe(JSON.stringify(before));
      });
    }
  });

  test("3. the triage worker claims none of the history mail and makes no LLM call; a pending mail is still triaged", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await syncedMailbox(trx);
      await insertDefaultSettings(trx, s.ctx, s.mailboxId);
      await triagedH4(trx, s.mailboxId);
      await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: sinceOf(), purpose: "history" });
      const control = await trx
        .insertInto("emails")
        .values({
          org_id: s.ctx.orgId,
          mailbox_id: s.mailboxId,
          dedup_key: "test:control",
          thread_key: "test:control",
          content_hash: "h",
          uid: 50,
          received_at: ago(HOUR_MS),
          status: "pending",
          from_address: "someone@x.test",
          subject: "control",
          body_text: "control body",
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const prompts: string[] = [];
      const llm = {
        modelOf: () => "fake-model",
        endpointOf: () => "standard",
        providerOf: () => "openai",
        async generate(req) {
          prompts.push(req.prompt);
          return {
            data: req.schema.parse({
              category: "info",
              confidence: 0.9,
              reason_code: "newsletter",
              reason: "a newsletter",
              summary: "short",
              fields: { due_date: null, language: "pl", delegate_id: null, task: null, clarification: null },
            }),
            usage: {
              role: req.role,
              promptVersion: req.promptVersion,
              model: "fake-model",
              tokensIn: 1,
              tokensOut: 1,
              latencyMs: 1,
              endpoint: "standard",
              provider: "openai" as const,
            },
          };
        },
      } as LlmClient;
      await createTriageJob({
        runningKey: noGateEvidence.runningKey,
        db: trx,
        llm,
        pause: createLlmPause(),
        scope: { kind: "all" },
        batchSize: 10,
        testMail: NO_TEST_SENDERS,
        dailyCap: 1000,
        now: () => NOW,
      }).run();

      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toContain("control");
      const rows = await rowsOf(trx, s.mailboxId);
      for (const n of [2, 3]) expect(byId(rows, n)).toMatchObject({ status: "skipped", skip_reason: "history_check" });
      const controlRow = await trx
        .selectFrom("emails")
        .select("status")
        .where("id", "=", control.id)
        .executeTakeFirstOrThrow();
      expect(controlRow.status).toBe("triaged");
    });
  });

  test("4. the digest of that day has no skipped or waiting line for the history mail, and no email.skipped audit row exists", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await triagedH4(trx, s.mailboxId);
      await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: sinceOf(), purpose: "history" });
      const audits = await trx
        .selectFrom("audit_log")
        .select("event")
        .where("org_id", "=", s.ctx.orgId)
        .where("event", "=", auditEvents.emailSkipped)
        .execute();
      expect(audits).toHaveLength(0);
      const message = await buildDigestMessage(trx, s.ctx, {
        kind: "scheduled",
        periodStart: ago(30 * DAY_MS),
        periodEnd: NOW,
        slot: { date: "2026-11-03", time: "13:00", late: false },
        now: NOW,
        locale: "en",
        role: "owner",
        testMail: NO_TEST_SENDERS,
      });
      expect(message.text).not.toContain("Not processed");
      expect(message.text).not.toContain("from the account pause");
      expect(message.text).not.toContain("Waiting for triage");
      expect(message.text).not.toContain("Mail 2");
      expect(message.text).not.toContain("Mail 3");
    });
  });

  test("5. purpose omitted: the mail is pending, as before", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      const result = await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: sinceOf() });
      expect(result.mode).toBe("backfill");
      expect(result.stored).toBe(2);
      const rows = await rowsOf(trx, s.mailboxId);
      for (const n of [2, 3]) {
        expect(byId(rows, n).status).toBe("pending");
        expect(byId(rows, n).skip_reason).toBeNull();
      }
    });
  });

  test("6. after a history run, the operator backfill re-queues the history mail of its window as pending, with an audit row", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await triagedH4(trx, s.mailboxId);
      await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: sinceOf(), purpose: "history" });

      // As `mailbox:backfill`: the read, then the re-queue of the window.
      const result = await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, {
        since: sinceOf(),
        purpose: undefined,
      });
      expect(result.stored).toBe(0);
      const requeued = await requeueBackfillWindow(trx, s.ctx, s.mailboxId, { since: sinceOf(), now: NOW });
      expect(requeued).toBe(2);
      const rows = await rowsOf(trx, s.mailboxId);
      for (const n of [2, 3]) expect(byId(rows, n)).toMatchObject({ status: "pending", skip_reason: null });
      expect(byId(rows, 4).status).toBe("triaged");
      const audits = await trx
        .selectFrom("audit_log")
        .select("reason_code")
        .where("org_id", "=", s.ctx.orgId)
        .where("event", "=", auditEvents.emailRequeued)
        .execute();
      expect(audits.map((row) => row.reason_code)).toEqual(["backfill", "backfill"]);
    });
  });

  test("the re-queue leaves history mail outside its window", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: sinceOf(), purpose: "history" });
      // Only the newer mail (h3, 10 days) is in a 15-day window.
      expect(await requeueBackfillWindow(trx, s.ctx, s.mailboxId, { since: sinceOf(15), now: NOW })).toBe(1);
      const rows = await rowsOf(trx, s.mailboxId);
      expect(byId(rows, 3).status).toBe("pending");
      expect(byId(rows, 2)).toMatchObject({ status: "skipped", skip_reason: "history_check" });
    });
  });
});

describe("history purpose: only mail of before the connect", () => {
  test("mail above the cursor is left to the regular sync, which stores it pending", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      // A live mail that arrived after the last sync tick: UID 5, the cursor is 4.
      s.fake.deliver("INBOX", seed(9), { internalDate: ago(10 * 60_000) });
      const outcome = await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, {
        since: sinceOf(),
        purpose: "history",
      });
      expect(outcome).toMatchObject({ kind: "done", result: { fetched: 3, stored: 2 } });
      expect((await rowsOf(trx, s.mailboxId)).map((row) => row.message_id_header)).not.toContain("<h9@x.test>");

      const next = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(next).toMatchObject({ stored: 1, uidUpdated: 0 });
      expect(byId(await rowsOf(trx, s.mailboxId), 9)).toMatchObject({ status: "pending", skip_reason: null });
    });
  });

  test("a mail at the cursor is history mail", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      const outcome = await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, {
        since: sinceOf(),
        purpose: "history",
      });
      // h4 sits at UID 4 = the cursor and is stored already; h2 and h3 are below it.
      expect(outcome).toMatchObject({ kind: "done", result: { fetched: 3 } });
    });
  });

  test("the purpose backfill still stores mail above the cursor", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      s.fake.deliver("INBOX", seed(9), { internalDate: ago(10 * 60_000) });
      const result = await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: sinceOf() });
      expect(result.stored).toBe(3);
    });
  });

  test("a history run drops the returned and relocated writes: a moved row keeps its folder, UID and returned_at", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      // The operator backfill stores h2 and h3; then h2 looks system-moved (it sits in AI/Info, its source is INBOX) and h3 looks
      // user-moved (it sits in Oferty, its own source folder). Both mails are in INBOX on the server: the user moved them back.
      await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: sinceOf() });
      const moveRow = (n: number, folder: string, sourceFolder: string) =>
        trx
          .updateTable("emails")
          .set({ folder, source_folder: sourceFolder })
          .where("mailbox_id", "=", s.mailboxId)
          .where("message_id_header", "=", `<h${n}@x.test>`)
          .execute();
      await moveRow(2, "AI/Info", "INBOX");
      await moveRow(3, "Oferty", "Oferty");
      const before = await rowsOf(trx, s.mailboxId);

      const outcome = await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, {
        since: sinceOf(),
        purpose: "history",
      });
      expect(outcome).toMatchObject({ kind: "done", result: { stored: 0, returned: 0, relocated: 0, uidUpdated: 0 } });
      const after = await rowsOf(trx, s.mailboxId);
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
      expect(byId(after, 2)).toMatchObject({ folder: "AI/Info", returned_at: null });
      expect(byId(after, 3)).toMatchObject({ folder: "Oferty" });

      // The same setup does move both rows for the operator backfill: the history run left them alone on purpose.
      const control = await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: sinceOf() });
      expect(control).toMatchObject({ returned: 1, relocated: 1 });
    });
  });

  test("no triage_results row exists for a history mail, also after the triage worker ran", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const s = await syncedMailbox(trx);
      await insertDefaultSettings(trx, s.ctx, s.mailboxId);
      await triagedH4(trx, s.mailboxId);
      await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: sinceOf(), purpose: "history" });
      const llm = {
        modelOf: () => "fake-model",
        endpointOf: () => "standard",
        providerOf: () => "openai",
        async generate(req) {
          return {
            data: req.schema.parse({
              category: "info",
              confidence: 0.9,
              reason_code: "newsletter",
              reason: "a newsletter",
              summary: "short",
              fields: { due_date: null, language: "pl", delegate_id: null, task: null, clarification: null },
            }),
            usage: {
              role: req.role,
              promptVersion: req.promptVersion,
              model: "fake-model",
              tokensIn: 1,
              tokensOut: 1,
              latencyMs: 1,
              endpoint: "standard",
              provider: "openai" as const,
            },
          };
        },
      } as LlmClient;
      await createTriageJob({
        runningKey: noGateEvidence.runningKey,
        db: trx,
        llm,
        pause: createLlmPause(),
        scope: { kind: "all" },
        batchSize: 10,
        testMail: NO_TEST_SENDERS,
        dailyCap: 1000,
        now: () => NOW,
      }).run();
      const rows = await rowsOf(trx, s.mailboxId);
      const historyIds = [2, 3].map((n) => byId(rows, n).id);
      const results = await trx
        .selectFrom("triage_results")
        .select("email_id")
        .where("email_id", "in", historyIds)
        .execute();
      expect(results).toEqual([]);
    });
  });
});

describe("history purpose: refusals are values", () => {
  const refused = (reason: BackfillRefusal): HistoryBackfillOutcome => ({ kind: "refused", reason });

  test("never synced, UIDVALIDITY change, suspended organization and a window over 180 days", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      const history = (since = sinceOf()) =>
        backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since, purpose: "history" });

      expect(await history(ago(181 * DAY_MS))).toEqual(refused("window_too_long"));

      s.fake.resetUidValidity(UID_VALIDITY + 1);
      expect(await history()).toEqual(refused("uidvalidity_changed"));
      s.fake.resetUidValidity(UID_VALIDITY);
      expect((await rowsOf(trx, s.mailboxId)).length).toBe(1);

      await suspendOrg(trx, s.ctx.orgId);
      expect(await history()).toEqual(refused("org_suspended"));
      expect((await rowsOf(trx, s.mailboxId)).length).toBe(1);

      const other = await createOrgWithMailbox(trx);
      const never = await backfillInbox(deps(trx, createFakeMailProvider()), { orgId: other.orgId }, other.mailboxId, {
        since: sinceOf(),
        purpose: "history",
      });
      expect(never).toEqual(refused("never_synced"));
    });
  });

  test("an unknown mailbox or the mailbox of another organization is still an error", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      const other = await createOrgWithMailbox(trx);
      await expect(
        backfillInbox(deps(trx, s.fake), { orgId: other.orgId }, s.mailboxId, { since: sinceOf(), purpose: "history" })
      ).rejects.toBeInstanceOf(HardError);
    });
  });

  test("the purpose backfill still throws its refusals", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      s.fake.resetUidValidity(UID_VALIDITY + 1);
      await expect(backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: sinceOf() })).rejects.toBeInstanceOf(
        SoftError
      );
      await expect(
        backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: ago(181 * DAY_MS) })
      ).rejects.toBeInstanceOf(HardError);
    });
  });
});

describe("history purpose: backfillMailbox opens through openMailboxProvider", () => {
  async function withSecret(
    trx: Transaction<DB>,
    s: { ctx: TenantContext; mailboxId: string },
    kind: "password" | "oauth"
  ) {
    if (kind === "oauth") {
      await trx.updateTable("mailboxes").set({ oauth_provider: "google" }).where("id", "=", s.mailboxId).execute();
    }
    const sealed = secrets.encrypt(kind === "oauth" ? "{}" : "pw", `mailbox:${s.mailboxId}`);
    await insertCredentials(trx, s.ctx, {
      mailboxId: s.mailboxId,
      encryptedSecret: sealed.ciphertext,
      secretKind: kind,
      keyVersion: sealed.keyVersion,
    });
  }

  const tokens = (calls: string[]): OAuthTokens => ({
    accessToken: async (_ctx, mailboxId, _resource, opts) => {
      calls.push(opts?.fresh === true ? `fresh:${mailboxId}` : `token:${mailboxId}`);
      return "the-access-token";
    },
    drop: () => undefined,
  });

  test("7. an OAuth mailbox logs in with auth.kind oauth, stores the history rows, and closes the provider", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "oauth");
      const seen: string[] = [];
      const tokenCalls: string[] = [];
      const outcome = await backfillMailbox(
        {
          db: trx,
          secrets,
          isOwnActionId: async () => false,
          oauthTokens: tokens(tokenCalls),
          openProvider: async (opts) => {
            seen.push(opts.auth.kind === "oauth" ? `oauth:${opts.auth.accessToken}` : "password");
            return s.fake;
          },
        },
        s.ctx,
        s.mailboxId,
        { days: SINCE_DAYS, now: NOW, purpose: "history" }
      );
      expect(seen).toEqual(["oauth:the-access-token"]);
      expect(tokenCalls).toEqual([`token:${s.mailboxId}`]);
      expect(outcome).toMatchObject({ kind: "done", result: { stored: 2 } });
      const rows = await rowsOf(trx, s.mailboxId);
      for (const n of [2, 3]) expect(byId(rows, n)).toMatchObject({ status: "skipped", skip_reason: "history_check" });
      expect(s.fake.closed).toBe(true);
    });
  });

  test("a password mailbox opens with auth.kind password", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "password");
      const seen: string[] = [];
      const outcome = await backfillMailbox(
        {
          db: trx,
          secrets,
          isOwnActionId: async () => false,
          openProvider: async (opts) => {
            seen.push(opts.auth.kind);
            return s.fake;
          },
        },
        s.ctx,
        s.mailboxId,
        { days: SINCE_DAYS, now: NOW, purpose: "history" }
      );
      expect(seen).toEqual(["password"]);
      expect(outcome).toMatchObject({ kind: "done", result: { stored: 2 } });
    });
  });

  test("8. a refused login is auth_refused, not a throw: password, OAuth refused twice, and a grant the token store refuses", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "password");
      let opened = 0;
      const refusing = async () => {
        opened += 1;
        throw new MailAuthError("refused");
      };
      const run = (extra: Partial<Parameters<typeof backfillMailbox>[0]> = {}) =>
        backfillMailbox(
          { db: trx, secrets, isOwnActionId: async () => false, openProvider: refusing, ...extra },
          s.ctx,
          s.mailboxId,
          { days: SINCE_DAYS, now: NOW, purpose: "history" }
        );
      expect(await run()).toEqual({ kind: "refused", reason: "auth_refused" });
      expect(opened).toBe(1);
      expect((await rowsOf(trx, s.mailboxId)).length).toBe(1);
    });
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "oauth");
      const tokenCalls: string[] = [];
      // The login is refused with the cached token and with the fresh one: `protocolDisabled`.
      const outcome = await backfillMailbox(
        {
          db: trx,
          secrets,
          isOwnActionId: async () => false,
          oauthTokens: tokens(tokenCalls),
          openProvider: async () => {
            throw new MailAuthError("IMAP login failed");
          },
        },
        s.ctx,
        s.mailboxId,
        { days: SINCE_DAYS, now: NOW, purpose: "history" }
      );
      expect(outcome).toEqual({ kind: "refused", reason: "auth_refused" });
      expect(tokenCalls).toEqual([`token:${s.mailboxId}`, `fresh:${s.mailboxId}`]);
    });
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "oauth");
      const outcome = await backfillMailbox(
        {
          db: trx,
          secrets,
          isOwnActionId: async () => false,
          oauthTokens: {
            accessToken: async () => {
              throw new MailAuthError("oauth grant refused", { reason: "oauth_expired" });
            },
            drop: () => undefined,
          },
          openProvider: async () => s.fake,
        },
        s.ctx,
        s.mailboxId,
        { days: SINCE_DAYS, now: NOW, purpose: "history" }
      );
      expect(outcome).toEqual({ kind: "refused", reason: "auth_refused" });
    });
    expect(protocolDisabled()).toBeInstanceOf(MailAuthError);
  });

  test("a network fault at the login is an error (the job counts an attempt), and a missing OAuth wiring is an error", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "password");
      await expect(
        backfillMailbox(
          {
            db: trx,
            secrets,
            isOwnActionId: async () => false,
            openProvider: async () => {
              throw new SoftError("connection reset");
            },
          },
          s.ctx,
          s.mailboxId,
          { days: SINCE_DAYS, now: NOW, purpose: "history" }
        )
      ).rejects.toBeInstanceOf(SoftError);
    });
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "oauth");
      await expect(
        backfillMailbox(
          { db: trx, secrets, isOwnActionId: async () => false, openProvider: async () => s.fake },
          s.ctx,
          s.mailboxId,
          { days: SINCE_DAYS, now: NOW, purpose: "history" }
        )
      ).rejects.toThrow("oauth not wired");
    });
  });

  test("a refusal that needs no login opens no connection and asks no token", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      await withSecret(trx, s, "oauth");
      let opened = 0;
      const tokenCalls: string[] = [];
      const run = (days: number) =>
        backfillMailbox(
          {
            db: trx,
            secrets,
            isOwnActionId: async () => false,
            oauthTokens: tokens(tokenCalls),
            openProvider: async () => {
              opened += 1;
              return s.fake;
            },
          },
          s.ctx,
          s.mailboxId,
          { days, now: NOW, purpose: "history" }
        );
      expect(await run(181)).toEqual({ kind: "refused", reason: "window_too_long" });
      await suspendOrg(trx, s.ctx.orgId);
      expect(await run(SINCE_DAYS)).toEqual({ kind: "refused", reason: "org_suspended" });
      expect(opened).toBe(0);
      expect(tokenCalls).toEqual([]);

      const other = await createOrgWithMailbox(trx);
      await withSecret(trx, { ctx: { orgId: other.orgId }, mailboxId: other.mailboxId }, "oauth");
      const never = await backfillMailbox(
        {
          db: trx,
          secrets,
          isOwnActionId: async () => false,
          oauthTokens: tokens(tokenCalls),
          openProvider: async () => {
            opened += 1;
            return s.fake;
          },
        },
        { orgId: other.orgId },
        other.mailboxId,
        { days: SINCE_DAYS, now: NOW, purpose: "history" }
      );
      expect(never).toEqual({ kind: "refused", reason: "never_synced" });
      expect(opened).toBe(0);
      expect(tokenCalls).toEqual([]);
    });
  });

  test("a mail with the X-EA-Action-Id of an own draft is not stored as history mail", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      const { insertTestEmail, insertAction } = await import("./fixtures");
      const emailId = await insertTestEmail(trx, s.ctx, s.mailboxId);
      const draftId = await insertAction(trx, s.ctx, emailId, { type: "create_draft", status: "ready" });
      s.fake.deliver("INBOX", { ...seed(6), headers: { "X-EA-Action-Id": draftId } }, { internalDate: ago(HOUR_MS) });
      // The draft is mail of before the connect: the sync cursor has passed it (a history run reads only up to the cursor).
      await updateCursor(
        trx,
        s.ctx,
        s.mailboxId,
        { uidValidity: UID_VALIDITY, lastUid: 4 },
        { uidValidity: UID_VALIDITY, lastUid: 5 }
      );
      const outcome = await backfillInbox(
        {
          ...deps(trx, s.fake),
          isOwnActionId: (ctx, mailboxId, actionId) => isOwnActionId(trx, ctx, mailboxId, actionId),
        },
        s.ctx,
        s.mailboxId,
        { since: sinceOf(), purpose: "history" }
      );
      expect(outcome).toMatchObject({ kind: "done", result: { skippedOwn: 1 } });
      expect((await rowsOf(trx, s.mailboxId)).map((row) => row.message_id_header)).not.toContain("<h6@x.test>");
    });
  });
});

describe("the history rows are normal mail rows for everything else", () => {
  test("a history mail of a mailbox does not move the cursor, and the next sync finds it above the cursor without a duplicate", async () => {
    await withRollback(db, async (trx) => {
      const s = await syncedMailbox(trx);
      const cursor = await cursorOf(trx, s.mailboxId);
      await backfillInbox(deps(trx, s.fake), s.ctx, s.mailboxId, { since: sinceOf(), purpose: "history" });
      expect(await cursorOf(trx, s.mailboxId)).toEqual(cursor);
      const next = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(next.stored).toBe(0);
      expect((await rowsOf(trx, s.mailboxId)).length).toBe(3);
    });
  });
});
