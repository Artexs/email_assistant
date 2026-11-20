import { DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { auditEvents } from "../../src/modules/audit";
import { insertDefaultSettings } from "../../src/modules/config";
import { backfillInbox, NO_TEST_SENDERS, syncMailbox } from "../../src/modules/mail";
import { buildDigestMessage } from "../../src/modules/reports";
import { createLlmPause, createTriageJob, noGateEvidence } from "../../src/modules/triage";
import { requeueBackfillWindow } from "../../src/modules/triage";
import type { DB, Db } from "../../src/platform/db";
import type { LlmClient } from "../../src/platform/llm";

import { pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { NOW, ago, seed, deps, syncedMailbox, rowsOf, byId, cursorOf, sinceOf } from "./mail-history-backfill-helpers";

// The history check of the trust ladder, step 1: the INBOX backfill in the `history` purpose. The mail is stored for the history check and never reaches triage.
// The provider is the in-memory fake (no mailbox, no LLM call).
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

async function headerCount(trx: Db | Transaction<DB>, mailboxId: string): Promise<number> {
  const rows = await trx
    .selectFrom("email_headers")
    .innerJoin("emails", "emails.id", "email_headers.email_id")
    .select("email_headers.email_id")
    .where("emails.mailbox_id", "=", mailboxId)
    .execute();
  return rows.length;
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
        junkDailyCap: 1000,
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
      s.fake.deliver("INBOX", seed(9), { internalDate: ago(10 * MINUTE_MS) });
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
      s.fake.deliver("INBOX", seed(9), { internalDate: ago(10 * MINUTE_MS) });
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
        junkDailyCap: 1000,
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
