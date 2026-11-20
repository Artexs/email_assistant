import { unitCost, HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  listLlmCallRows,
  recordAudit,
  recordLlmCall,
  sumLlmCallsByModelSince,
  auditEvents,
} from "../../src/modules/audit";
import { NO_TEST_SENDERS } from "../../src/modules/mail";
import { llmToday } from "../../src/modules/operator/service";
import { insertTriageResult, listUsageSince } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";
import { groupUsage, modelReportLines } from "../../src/scripts/lib/triage-cost-report";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The endpoint in `llm.call` rows, and the cost readers that price by it.
const db = testDb();
const NOW = new Date("2026-11-20T10:00:00Z");

afterAll(async () => {
  await db.destroy();
});

type Kind = "standard" | "eu" | "own";

function call(trx: Transaction<DB>, ctx: TenantContext, mailboxId: string, endpoint: Kind | undefined, when: string) {
  const base = {
    mailboxId,
    role: "classifier" as const,
    promptVersion: "p1",
    model: "gpt-6-luna",
    provider: "openai" as const,
    outcome: "ok",
    tokensIn: 1000,
    tokensOut: 1000,
    latencyMs: 10,
    at: new Date(when),
  };
  if (endpoint !== undefined) return recordLlmCall(trx, ctx, { ...base, endpoint });
  // The old shape: a row written before the endpoint was logged has no `endpoint` key.
  return recordAudit(trx, ctx, {
    actor: "system",
    event: auditEvents.llmCall,
    reasonCode: "ok",
    data: {
      mailbox_id: mailboxId,
      role: "classifier",
      model: "gpt-6-luna",
      prompt_version: "p1",
      tokens_in: 1000,
      tokens_out: 1000,
      latency_ms: 10,
    },
    at: base.at,
  });
}

describe("endpoint in llm.call rows and cost readers (F111 stage 03)", () => {
  test("5. llmToday prices a standard row and an eu row of one model at their own rates; org B stays out", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const ctxA = { orgId: a.orgId };
      await call(trx, ctxA, a.mailboxId, "standard", "2026-11-20T08:30:00Z");
      await call(trx, ctxA, a.mailboxId, "eu", "2026-11-20T08:40:00Z");
      await call(trx, { orgId: b.orgId }, b.mailboxId, "eu", "2026-11-20T08:45:00Z");
      const today = await llmToday(trx, ctxA, NOW);
      expect(today.calls).toBe(2);
      expect(today.unpricedCalls).toBe(0);
      expect(today.costUsd).toBeCloseTo(0.0006 + 0.00066, 10);
    });
  });

  test("an own row costs 0 and is not unpriced, also for a model with no price row", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctxA = { orgId: a.orgId };
      await recordLlmCall(trx, ctxA, {
        mailboxId: a.mailboxId,
        role: "classifier",
        promptVersion: "p1",
        model: "SpeakLeash/bielik-11b-v3.1:Q4_K_M",
        endpoint: "own",
        provider: "openai" as const,
        outcome: "ok",
        tokensIn: 1_000_000,
        tokensOut: 1_000_000,
        latencyMs: 10,
        at: new Date("2026-11-20T08:30:00Z"),
      });
      expect(await llmToday(trx, ctxA, NOW)).toMatchObject({ calls: 1, costUsd: 0, unpricedCalls: 0 });
    });
  });

  test("6. a row in the old shape (no endpoint key) groups as standard, apart from an eu row of the same model", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctxA = { orgId: a.orgId };
      await call(trx, ctxA, a.mailboxId, undefined, "2026-11-20T08:30:00Z");
      await call(trx, ctxA, a.mailboxId, "standard", "2026-11-20T08:31:00Z");
      await call(trx, ctxA, a.mailboxId, "eu", "2026-11-20T08:32:00Z");
      expect(await sumLlmCallsByModelSince(trx, ctxA, new Date("2026-11-20T08:00:00Z"))).toEqual([
        { model: "gpt-6-luna", endpoint: "eu", calls: 1, tokensIn: 1000, tokensOut: 1000 },
        { model: "gpt-6-luna", endpoint: "standard", calls: 2, tokensIn: 2000, tokensOut: 2000 },
      ]);
      const rows = await listLlmCallRows(trx, ctxA, {
        range: { start: new Date("2026-11-20T00:00:00Z"), end: new Date("2026-11-21T00:00:00Z") },
        mailboxId: null,
      });
      expect(rows.map((row) => row.endpoint)).toEqual(["standard", "standard", "eu"]);
    });
  });

  test("a damaged endpoint value in a row reads as standard (never cheaper)", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctxA = { orgId: a.orgId };
      await recordAudit(trx, ctxA, {
        actor: "system",
        event: auditEvents.llmCall,
        reasonCode: "ok",
        data: { model: "gpt-6-luna", endpoint: "free", tokens_in: 1000, tokens_out: 1000 },
        at: new Date("2026-11-20T08:30:00Z"),
      });
      const rows = await sumLlmCallsByModelSince(trx, ctxA, new Date("2026-11-20T08:00:00Z"));
      expect(rows.map((row) => row.endpoint)).toEqual(["standard"]);
    });
  });

  test("7. unitCost over listLlmCallRows: an own row of 1,000,000 tokens gives 0 and no unpriced call", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctxA = { orgId: a.orgId };
      await recordLlmCall(trx, ctxA, {
        mailboxId: a.mailboxId,
        role: "classifier",
        promptVersion: "p1",
        model: "gemma3:12b",
        endpoint: "own",
        provider: "openai" as const,
        outcome: "ok",
        tokensIn: 1_000_000,
        tokensOut: 0,
        latencyMs: 10,
        at: new Date("2026-11-20T08:30:00Z"),
      });
      const rows = await listLlmCallRows(trx, ctxA, {
        range: { start: new Date("2026-11-20T00:00:00Z"), end: new Date("2026-11-21T00:00:00Z") },
        mailboxId: null,
      });
      expect(unitCost(rows, { mailboxes: 1 })).toMatchObject({ llmUsdWeek: 0, unpricedCalls: 0, llmCalls: 1 });
    });
  });

  test("8. triage:cost reads the endpoint of each result and prices it at its own rate", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const ctxA = { orgId: a.orgId };
      const add = async (endpoint: Kind) => {
        const emailId = await insertTestEmail(trx, ctxA, a.mailboxId, { status: "triaged" });
        await insertTriageResult(trx, ctxA, {
          emailId,
          category: "info",
          vip: false,
          confidence: 0.9,
          reasonCode: "llm",
          reason: null,
          fields: {},
          model: "gpt-6-luna",
          promptVersion: "classifier-v2",
          tokensIn: 1000,
          tokensOut: 1000,
          latencyMs: 100,
        });
        await recordLlmCall(trx, ctxA, {
          emailId,
          mailboxId: a.mailboxId,
          role: "classifier",
          promptVersion: "classifier-v2",
          model: "gpt-6-luna",
          endpoint,
          provider: "openai" as const,
          outcome: "ok",
          tokensIn: 1000,
          tokensOut: 1000,
          latencyMs: 100,
          at: new Date(),
        });
      };
      await add("standard");
      await add("eu");
      const since = new Date(Date.now() - HOUR_MS);
      const rows = await listUsageSince(trx, ctxA, a.mailboxId, since, { mail: "real", testMail: NO_TEST_SENDERS });
      expect(rows.map((row) => row.endpoint).sort()).toEqual(["eu", "standard"]);
      const groups = groupUsage(rows);
      expect(groups.map((g) => `${g.model}/${g.endpoint}`).sort()).toEqual(["gpt-6-luna/eu", "gpt-6-luna/standard"]);
      const text = groups.map((g) => modelReportLines(g, 1).join("\n")).join("\n");
      expect(text).toContain("model gpt-6-luna endpoint eu");
      expect(text).toContain("average cost per mail: $0.000660");
      expect(text).toContain("average cost per mail: $0.000600");
    });
  });
});
