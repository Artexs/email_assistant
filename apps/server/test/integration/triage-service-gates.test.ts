import { MINUTE_MS, DAY_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { auditEvents, recordAudit } from "../../src/modules/audit";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { triageOne } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";
import { type LlmClient } from "../../src/platform/llm";

import { testDb, withRollback } from "./helpers";
import {
  now,
  results,
  audit,
  emailStatus,
  fakeLlm,
  analysis,
  fakePause,
  setupMail,
  llmRows,
} from "./triage-service-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("triageOne: cost gates", () => {
  const dayStart = new Date("2026-11-05T08:00:00Z");
  const nextDayStart = new Date("2026-11-06T08:00:00Z");
  const eightDaysAgo = new Date(now.getTime() - 8 * DAY_MS);

  function deps(trx: Transaction<DB>, llm: LlmClient, dailyCap = 1000, junkDailyCap = 1000) {
    return { db: trx, llm, pause: fakePause(), testMail: NO_TEST_SENDERS, dailyCap, junkDailyCap, now: () => now };
  }

  async function addLlmCalls(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string, at: Date[]) {
    for (const when of at) {
      await recordAudit(trx, ctx, {
        actor: "system",
        event: auditEvents.llmCall,
        reasonCode: "ok",
        data: { mailbox_id: mailboxId },
        at: when,
      });
    }
  }

  test("a mail older than 7 days is skipped as too_old, without an LLM call", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, { received_at: eightDaysAgo });
      const llm = fakeLlm(analysis());
      expect(await triageOne(deps(trx, llm), ctx, mailbox, email)).toEqual({ kind: "skipped" });

      expect(llm.requests).toHaveLength(0);
      const mail = await trx
        .selectFrom("emails")
        .select(["status", "skip_reason", "locked_at"])
        .where("id", "=", emailId)
        .executeTakeFirstOrThrow();
      expect(mail).toEqual({ status: "skipped", skip_reason: "too_old", locked_at: null });
      const skipped = (await audit(trx, emailId)).filter((r) => r.event === "email.skipped");
      expect(skipped).toHaveLength(1);
      expect(skipped[0]?.reason_code).toBe("too_old");
      expect(skipped[0]?.data).toEqual({ mailbox_id: mailbox.id });
      expect(await results(trx, emailId)).toHaveLength(0);
      expect(await llmRows(trx, emailId)).toHaveLength(0);
    });
  });

  test("a too_old mail with a lost claim returns lost and writes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, { received_at: eightDaysAgo });
      await trx
        .updateTable("emails")
        .set({ locked_at: new Date(now.getTime() + MINUTE_MS) })
        .where("id", "=", emailId)
        .execute();
      expect(await triageOne(deps(trx, fakeLlm(analysis())), ctx, mailbox, email)).toEqual({ kind: "lost" });
      expect(await emailStatus(trx, emailId)).toBe("processing");
      expect((await audit(trx, emailId)).filter((r) => r.event === "email.skipped")).toHaveLength(0);
    });
  });

  test("an 8-day-old mail with backfilled_at is triaged with an LLM call", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, {
        received_at: eightDaysAgo,
        backfilled_at: now,
      });
      const llm = fakeLlm(analysis());
      expect(await triageOne(deps(trx, llm), ctx, mailbox, email)).toEqual({ kind: "triaged" });
      expect(llm.requests).toHaveLength(1);
      expect(await emailStatus(trx, emailId)).toBe("triaged");
    });
  });

  test("a backfilled mail that lost its body to retention is skipped as body_expired; no LLM call (F083)", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, {
        received_at: eightDaysAgo,
        created_at: new Date(now.getTime() - 40 * DAY_MS),
        backfilled_at: now,
        body_text: null,
      });
      const llm = fakeLlm(analysis());

      expect(await triageOne(deps(trx, llm), ctx, mailbox, email)).toEqual({ kind: "skipped" });

      expect(llm.requests).toHaveLength(0);
      const mail = await trx
        .selectFrom("emails")
        .select(["status", "skip_reason", "locked_at"])
        .where("id", "=", emailId)
        .executeTakeFirstOrThrow();
      expect(mail).toEqual({ status: "skipped", skip_reason: "body_expired", locked_at: null });
      const skipped = (await audit(trx, emailId)).filter((r) => r.event === "email.skipped");
      expect(skipped.map((row) => row.reason_code)).toEqual(["body_expired"]);
      expect(await llmRows(trx, emailId)).toHaveLength(0);
    });
  });

  test("a backfilled mail with a body, or without a body but stored under 7 days ago, is triaged", async () => {
    await withRollback(db, async (trx) => {
      const old = new Date(now.getTime() - 40 * DAY_MS);
      const withBody = await setupMail(trx, { created_at: old, backfilled_at: now, body_text: "Body" });
      const fresh = await setupMail(trx, { created_at: now, backfilled_at: now, body_text: null });
      for (const one of [withBody, fresh]) {
        const llm = fakeLlm(analysis());
        expect(await triageOne(deps(trx, llm), one.ctx, one.mailbox, one.email)).toEqual({ kind: "triaged" });
        expect(llm.requests).toHaveLength(1);
      }
    });
  });

  test("at the daily cap the mail waits for the next quota day; no LLM call", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx);
      await addLlmCalls(trx, ctx, mailbox.id, [dayStart, new Date(now.getTime() - MINUTE_MS)]);
      const llm = fakeLlm(analysis());

      expect(await triageOne(deps(trx, llm, 2), ctx, mailbox, email)).toEqual({
        kind: "capped",
        until: nextDayStart,
        dayStart,
      });
      expect(llm.requests).toHaveLength(0);
      const mail = await trx.selectFrom("emails").selectAll().where("id", "=", emailId).executeTakeFirstOrThrow();
      expect(mail.status).toBe("pending");
      expect(mail.next_attempt_at).toEqual(nextDayStart);
      expect(mail.attempts).toBe(0);
      expect(mail.locked_at).toBeNull();
    });
  });

  test("calls from before the quota day start do not count", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, email, mailbox } = await setupMail(trx);
      await addLlmCalls(trx, ctx, mailbox.id, [
        new Date(dayStart.getTime() - 1),
        new Date(dayStart.getTime() - HOUR_MS),
      ]);
      const llm = fakeLlm(analysis());
      expect(await triageOne(deps(trx, llm, 2), ctx, mailbox, email)).toEqual({ kind: "triaged" });
      expect(llm.requests).toHaveLength(1);
    });
  });

  test("a blocklist mail is still triaged at the cap", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx, { from_address: "bad@spam.test" }, [
        { pattern: "spam.test", kind: "blocklist" },
      ]);
      await addLlmCalls(trx, ctx, mailbox.id, [dayStart, dayStart]);
      const llm = fakeLlm(analysis());
      expect(await triageOne(deps(trx, llm, 2), ctx, mailbox, email)).toEqual({ kind: "triaged" });
      expect(llm.requests).toHaveLength(0);
      expect(await emailStatus(trx, emailId)).toBe("triaged");
    });
  });
});
