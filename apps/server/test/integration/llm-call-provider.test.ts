import { MINUTE_MS, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { auditEvents, recordAudit, recordLlmCall } from "../../src/modules/audit";
import { getMailboxSettings, insertDefaultSettings } from "../../src/modules/config";
import { claimEmails, NO_TEST_SENDERS } from "../../src/modules/mail";
import {
  insertTriageResult,
  listUsageSince,
  noGateEvidence,
  triageOne,
  type LlmPause,
  type TriageMailbox,
} from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";
import { LlmSoftError } from "../../src/platform/llm";
import { createFixedLlmClient } from "../../src/platform/llm/testing";
import { groupUsage, modelReportLines } from "../../src/scripts/lib/triage-cost-report";

import { createOrgWithMailbox, insertTestEmail, noSuspiciousContext } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The provider in `llm.call` rows (written by triage) and in the `triage:cost` report.
const db = testDb();
const now = new Date("2026-11-20T12:00:00.123Z");
const MODEL = "deepseek-flash";

afterAll(async () => {
  await db.destroy();
});

const answer = JSON.stringify({
  category: "info",
  confidence: 0.9,
  reason_code: "newsletter",
  reason: "a newsletter",
  summary: "short summary",
  fields: { due_date: null, language: "pl", delegate_id: null, task: null, clarification: null },
});

const pause: LlmPause = {
  trip: (_kind, _code, at) => new Date(at.getTime() + 5 * MINUTE_MS),
  isPaused: () => false,
  pausedUntil: () => null,
  pausedSince: () => null,
  reset: () => undefined,
};

async function setupMail(trx: Transaction<DB>) {
  const created = await createOrgWithMailbox(trx);
  const ctx: TenantContext = { orgId: created.orgId };
  await insertDefaultSettings(trx, ctx, created.mailboxId);
  const settings = await getMailboxSettings(trx, ctx, created.mailboxId);
  if (!settings) throw new Error("no settings");
  const emailId = await insertTestEmail(trx, ctx, created.mailboxId, { from_address: "news@shop.test" });
  const [email] = await claimEmails(trx, ctx, created.mailboxId, {
    now,
    limit: 10,
    staleBefore: new Date(now.getTime() - 5 * MINUTE_MS),
    syntheticOnly: false,
  });
  if (!email) throw new Error("claim failed");
  const mailbox: TriageMailbox = {
    id: created.mailboxId,
    settingsVersion: settings.version,
    mode: "shadow",
    toolSwitches: { move: true, mark_read: true, flag: true, create_draft: false, move_unsure: true },
    runningKey: noGateEvidence.runningKey,
    policy: { info: { auto: true } },
    rules: [],
    movesSupported: true,
    delegates: [],
    timezone: "Europe/Warsaw",
    junkFolder: null,
    resumedAt: null,
    suspicious: noSuspiciousContext,
    urgencyProfile: null,
  };
  return { ctx, emailId, email, mailbox };
}

async function llmCallData(trx: Transaction<DB>, ctx: TenantContext, emailId: string) {
  const rows = await trx
    .selectFrom("audit_log")
    .select(["reason_code", "data"])
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .where("event", "=", auditEvents.llmCall)
    .execute();
  return rows.map((row) => ({ reason: row.reason_code, data: row.data as Record<string, unknown> }));
}

describe("the provider in llm.call rows", () => {
  test("2. a triage run with a deepseek client writes one row with the provider, model, endpoint and tokens", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx);
      const llm = createFixedLlmClient(async () => ({ text: answer, tokensIn: 120, tokensOut: 30, blocked: false }), {
        provider: "deepseek",
        model: MODEL,
      });
      await triageOne(
        { db: trx, llm, pause, testMail: NO_TEST_SENDERS, dailyCap: 1000, junkDailyCap: 1000, now: () => now },
        ctx,
        mailbox,
        email
      );
      const rows = await llmCallData(trx, ctx, emailId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.reason).toBe("ok");
      expect(rows[0]?.data).toMatchObject({
        role: "classifier",
        provider: "deepseek",
        model: MODEL,
        endpoint: "standard",
        tokens_in: 120,
        tokens_out: 30,
      });
    });
  });

  test("3. a soft error writes one row whose provider comes from the client, with the error outcome", async () => {
    await withRollback(db, async (trx) => {
      const { ctx, emailId, email, mailbox } = await setupMail(trx);
      const llm = createFixedLlmClient(
        async () => {
          throw new LlmSoftError("http_503", MODEL);
        },
        { provider: "deepseek", model: MODEL }
      );
      await triageOne(
        { db: trx, llm, pause, testMail: NO_TEST_SENDERS, dailyCap: 1000, junkDailyCap: 1000, now: () => now },
        ctx,
        mailbox,
        email
      );
      const rows = await llmCallData(trx, ctx, emailId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.reason).toBe("http_503");
      expect(rows[0]?.data).toMatchObject({
        provider: "deepseek",
        model: MODEL,
        endpoint: "standard",
        tokens_in: null,
        tokens_out: null,
      });
    });
  });
});

describe("triage:cost groups by provider", () => {
  async function addResult(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string, provider: "deepseek" | null) {
    const emailId = await insertTestEmail(trx, ctx, mailboxId, { status: "triaged" });
    await insertTriageResult(trx, ctx, {
      emailId,
      category: "info",
      vip: false,
      confidence: 0.9,
      reasonCode: "llm",
      reason: null,
      fields: {},
      model: MODEL,
      promptVersion: "classifier-v2",
      tokensIn: 1000,
      tokensOut: 1000,
      latencyMs: 100,
    });
    const call = {
      emailId,
      mailboxId,
      role: "classifier" as const,
      promptVersion: "classifier-v2",
      model: MODEL,
      endpoint: "standard" as const,
      outcome: "ok",
      tokensIn: 1000,
      tokensOut: 1000,
      latencyMs: 100,
      at: new Date(),
    };
    if (provider !== null) {
      await recordLlmCall(trx, ctx, { ...call, provider });
      return;
    }
    // The old shape: a row written before the provider was logged has no `provider` key.
    await recordAudit(trx, ctx, {
      emailId,
      actor: "system",
      event: auditEvents.llmCall,
      reasonCode: "ok",
      data: {
        mailbox_id: mailboxId,
        role: call.role,
        model: MODEL,
        endpoint: "standard",
        prompt_version: call.promptVersion,
        tokens_in: 1000,
        tokens_out: 1000,
        latency_ms: 100,
      },
      at: call.at,
    });
  }

  test("5. one deepseek row and one old row make two groups: `deepseek` with a cost and `-`", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctxA = { orgId: a.orgId };
      await addResult(trx, ctxA, a.mailboxId, "deepseek");
      await addResult(trx, ctxA, a.mailboxId, null);
      // Another organization's row is not counted (the tenant filter of the grouped read).
      const b = await createOrgWithMailbox(trx);
      await addResult(trx, { orgId: b.orgId }, b.mailboxId, "deepseek");
      const rows = await listUsageSince(trx, ctxA, a.mailboxId, new Date(Date.now() - HOUR_MS), {
        mail: "real",
        testMail: NO_TEST_SENDERS,
      });
      const groups = groupUsage(rows);
      expect(rows).toHaveLength(2);
      expect(groups.map((g) => g.provider ?? "-").sort()).toEqual(["-", "deepseek"]);
      const text = groups.map((g) => modelReportLines(g, 1).join("\n")).join("\n");
      expect(text).toContain("provider deepseek model deepseek-flash endpoint standard");
      expect(text).toContain("provider - model deepseek-flash endpoint standard");
      // 1000 tokens in and out at 0.30 and 1.20 USD per 1M.
      expect(text).toContain("average cost per mail: $0.001500");
    });
  });
});
