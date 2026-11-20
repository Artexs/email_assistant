import { MINUTE_MS } from "@ea/core";
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import { ensureSyncFolders } from "../../src/modules/mail";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { createLlmPause, createTriageJob, noGateEvidence } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";
import { type LlmClient } from "../../src/platform/llm";

import { insertTestEmail, pauseOtherMailboxes } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { now, minutesFromNow, fakeLlm, mailboxWithSettings, emailRow } from "./triage-job-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

let errorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("createTriageJob: daily cap", () => {
  const dayStart = new Date("2026-11-05T08:00:00Z");

  function capLines(): string[] {
    return errorSpy.mock.calls
      .map((call: unknown[]) => String(call[1]))
      .filter((line: string) => line.startsWith("llm_daily_cap_reached"));
  }

  test("at the cap two runs log one warn line; a blocklist mail in the batch is triaged", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      await trx
        .insertInto("sender_rules")
        .values({ org_id: ctx.orgId, mailbox_id: mailboxId, pattern: "spam.test", kind: "blocklist" })
        .execute();
      for (let i = 0; i < 2; i += 1) {
        await recordAudit(trx, ctx, {
          actor: "system",
          event: auditEvents.llmCall,
          reasonCode: "ok",
          data: { mailbox_id: mailboxId },
          at: minutesFromNow(-10 + i),
        });
      }
      const first = await insertTestEmail(trx, ctx, mailboxId, {
        message_id_header: "<a@ea-seed.test>",
        received_at: minutesFromNow(-30),
      });
      const blocked = await insertTestEmail(trx, ctx, mailboxId, {
        message_id_header: "<b@ea-seed.test>",
        received_at: minutesFromNow(-20),
        from_address: "bad@spam.test",
      });
      const last = await insertTestEmail(trx, ctx, mailboxId, {
        message_id_header: "<c@ea-seed.test>",
        received_at: minutesFromNow(-10),
      });
      const llm = fakeLlm();
      const capped = createTriageJob({
        runningKey: noGateEvidence.runningKey,
        db: trx,
        llm,
        pause: createLlmPause(),
        scope: { kind: "synthetic", testMail: NO_TEST_SENDERS },
        batchSize: 5,
        testMail: NO_TEST_SENDERS,
        dailyCap: 2,
        junkDailyCap: 1000,
        now: () => now,
      });

      await capped.run();
      await capped.run();

      expect(llm.prompts).toHaveLength(0);
      expect((await emailRow(trx, blocked)).status).toBe("triaged");
      for (const id of [first, last]) {
        const row = await trx
          .selectFrom("emails")
          .select(["status", "attempts", "next_attempt_at"])
          .where("id", "=", id)
          .executeTakeFirstOrThrow();
        expect(row).toEqual({ status: "pending", attempts: 0, next_attempt_at: new Date("2026-11-06T08:00:00Z") });
      }
      const lines = capLines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(
        `llm_daily_cap_reached org_id=${ctx.orgId} mailbox_id=${mailboxId} count=2 day_start=${dayStart.toISOString()} until=2026-11-06T08:00:00.000Z`
      );
    });
  });

  test("the cap hook gets (ctx, mailbox id, quota day start) for a capped mail", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      await insertTestEmail(trx, ctx, mailboxId, { received_at: minutesFromNow(-30) });
      await insertTestEmail(trx, ctx, mailboxId, { received_at: minutesFromNow(-20) });
      const llm = fakeLlm();
      const calls: { ctx: TenantContext; mailboxId: string; dayStart: Date }[] = [];
      await createTriageJob({
        runningKey: noGateEvidence.runningKey,
        db: trx,
        llm,
        pause: createLlmPause(),
        scope: { kind: "all" },
        batchSize: 5,
        testMail: NO_TEST_SENDERS,
        dailyCap: 1,
        junkDailyCap: 1000,
        now: () => now,
        onCapReached: (hookCtx, hookMailboxId, hookDayStart) =>
          calls.push({ ctx: hookCtx, mailboxId: hookMailboxId, dayStart: hookDayStart }),
      }).run();

      expect(llm.prompts).toHaveLength(1);
      expect(calls).toEqual([{ ctx: { orgId: ctx.orgId }, mailboxId, dayStart }]);
    });
  });

  test("a cap hook that starts a promise that never settles does not stop the run or the next organization", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const a = await mailboxWithSettings(trx);
      const b = await mailboxWithSettings(trx);
      await trx
        .insertInto("sender_rules")
        .values({ org_id: a.orgId, mailbox_id: a.mailboxId, pattern: "x.test", kind: "blocklist" })
        .execute();
      // The cap of org A is reached; org B has the cap too, so it needs no call of its own: give B room by its own audit count.
      await recordAudit(trx, a.ctx, {
        actor: "system",
        event: auditEvents.llmCall,
        reasonCode: "ok",
        data: { mailbox_id: a.mailboxId },
        at: minutesFromNow(-10),
      });
      await insertTestEmail(trx, a.ctx, a.mailboxId, { received_at: minutesFromNow(-30) });
      const mailB = await insertTestEmail(trx, b.ctx, b.mailboxId, { received_at: minutesFromNow(-20) });
      const llm = fakeLlm();
      let hookCalls = 0;
      await createTriageJob({
        runningKey: noGateEvidence.runningKey,
        db: trx,
        llm,
        pause: createLlmPause(),
        scope: { kind: "all" },
        batchSize: 5,
        testMail: NO_TEST_SENDERS,
        dailyCap: 1,
        junkDailyCap: 1000,
        now: () => now,
        onCapReached: () => {
          hookCalls += 1;
          void new Promise<void>(() => undefined);
        },
      }).run();

      expect(hookCalls).toBe(1);
      expect((await emailRow(trx, mailB)).status).toBe("triaged");
      expect(llm.prompts).toHaveLength(1);
    });
  });
});

describe("createTriageJob: junk folder limit", () => {
  const dayStart = new Date("2026-11-05T08:00:00Z");
  const junkPath = "Wiadomości-śmieci";

  function junkCapLines(): string[] {
    return errorSpy.mock.calls
      .map((call: unknown[]) => String(call[1]))
      .filter((line: string) => line.startsWith("llm_junk_daily_cap_reached"));
  }

  // One `llm.call` row for a mail that is already triaged, so the job does not claim it.
  async function recordCall(
    trx: Transaction<DB>,
    ctx: TenantContext,
    mailboxId: string,
    folder: string,
    at: Date
  ): Promise<void> {
    const emailId = await insertTestEmail(trx, ctx, mailboxId, { status: "triaged", source_folder: folder });
    await recordAudit(trx, ctx, {
      emailId,
      actor: "system",
      event: auditEvents.llmCall,
      reasonCode: "ok",
      data: { mailbox_id: mailboxId },
      at,
    });
  }

  function junkJob(trx: Transaction<DB>, llm: LlmClient, junkDailyCap: number) {
    return createTriageJob({
      runningKey: noGateEvidence.runningKey,
      db: trx,
      llm,
      pause: createLlmPause(),
      scope: { kind: "all" },
      batchSize: 5,
      testMail: NO_TEST_SENDERS,
      dailyCap: 1000,
      junkDailyCap,
      now: () => now,
    });
  }

  test("over the junk limit, junk mail waits for the next quota day with one warning; inbox mail still runs", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      await ensureSyncFolders(trx, ctx, mailboxId, [{ key: "junk", path: junkPath, role: "junk" }], now);
      await recordCall(trx, ctx, mailboxId, junkPath, minutesFromNow(-10));
      await recordCall(trx, ctx, mailboxId, junkPath, minutesFromNow(-9));
      const junkMail = await insertTestEmail(trx, ctx, mailboxId, {
        received_at: minutesFromNow(-30),
        source_folder: junkPath,
      });
      const inboxMail = await insertTestEmail(trx, ctx, mailboxId, { received_at: minutesFromNow(-20) });
      const llm = fakeLlm();
      const limited = junkJob(trx, llm, 2);

      await limited.run();
      await limited.run();

      expect(llm.prompts).toHaveLength(1);
      expect((await emailRow(trx, inboxMail)).status).toBe("triaged");
      const waiting = await trx
        .selectFrom("emails")
        .select(["status", "attempts", "next_attempt_at"])
        .where("id", "=", junkMail)
        .executeTakeFirstOrThrow();
      expect(waiting).toEqual({ status: "pending", attempts: 0, next_attempt_at: new Date("2026-11-06T08:00:00Z") });
      expect(junkCapLines()).toEqual([
        `llm_junk_daily_cap_reached org_id=${ctx.orgId} mailbox_id=${mailboxId} count=2 day_start=${dayStart.toISOString()} until=2026-11-06T08:00:00.000Z`,
      ]);
    });
  });

  test("only junk folder calls of the quota day count against the junk limit", async () => {
    await withRollback(db, async (trx) => {
      await pauseOtherMailboxes(trx);
      const { ctx, mailboxId } = await mailboxWithSettings(trx);
      await ensureSyncFolders(trx, ctx, mailboxId, [{ key: "junk", path: junkPath, role: "junk" }], now);
      // Three inbox calls today and two junk calls of the day before: one junk call is left under a limit of 1.
      for (let i = 0; i < 3; i += 1) await recordCall(trx, ctx, mailboxId, "INBOX", minutesFromNow(-10 + i));
      await recordCall(trx, ctx, mailboxId, junkPath, new Date(dayStart.getTime() - MINUTE_MS));
      await recordCall(trx, ctx, mailboxId, junkPath, new Date(dayStart.getTime() - 120_000));
      const junkMail = await insertTestEmail(trx, ctx, mailboxId, {
        received_at: minutesFromNow(-30),
        source_folder: junkPath,
      });
      const llm = fakeLlm();

      await junkJob(trx, llm, 1).run();

      expect(llm.prompts).toHaveLength(1);
      expect((await emailRow(trx, junkMail)).status).toBe("triaged");
      expect(junkCapLines()).toEqual([]);
    });
  });
});
