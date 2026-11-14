import type { Category } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { NO_TEST_SENDERS } from "../../src/modules/mail";
import {
  buildRealPredictions,
  buildRealReport,
  insertFeedback,
  insertTriageResult,
  listLabeledResults,
  renderEvalReport,
  type TriageResultInput,
} from "../../src/modules/triage";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

interface Labeled {
  category?: Category;
  confidence?: number;
  reasonCode?: string;
  model?: string | null;
  fields?: Record<string, unknown>;
  verdict: "right" | "wrong";
  trueCategory?: Category | null;
  messageId?: string;
}

async function addLabeled(trx: Transaction<DB>, tenant: { orgId: string; mailboxId: string }, row: Labeled) {
  const ctx = { orgId: tenant.orgId };
  const emailId = await insertTestEmail(trx, ctx, tenant.mailboxId, {
    message_id_header: row.messageId ?? `<${crypto.randomUUID()}@x.test>`,
  });
  const result: TriageResultInput = {
    emailId,
    category: row.category ?? "info",
    vip: false,
    confidence: row.confidence ?? 0.9,
    reasonCode: row.reasonCode ?? "llm",
    reason: null,
    fields: row.fields ?? {},
    model: row.model === undefined ? "gemini-3.5-flash-lite" : row.model,
    promptVersion: "classifier-v1",
    tokensIn: null,
    tokensOut: null,
    latencyMs: null,
  };
  await insertTriageResult(trx, ctx, result);
  await insertFeedback(trx, ctx, {
    emailId,
    verdict: row.verdict,
    trueCategory: row.trueCategory ?? null,
    source: "cli",
    userId: null,
  });
  return emailId;
}

async function predictionsFor(trx: Transaction<DB>, tenant: { orgId: string; mailboxId: string }, rows: Labeled[]) {
  for (const row of rows) await addLabeled(trx, tenant, row);
  const labeled = await listLabeledResults(trx, { orgId: tenant.orgId }, tenant.mailboxId, {
    mail: "real",
    testMail: NO_TEST_SENDERS,
  });
  return { labeled, predictions: buildRealPredictions(labeled) };
}

describe("buildRealPredictions", () => {
  test("each verdict case gives its expected category", async () => {
    await withRollback(db, async (trx) => {
      const tenant = await createOrgWithMailbox(trx);
      const { predictions } = await predictionsFor(trx, tenant, [
        { category: "info", verdict: "right", trueCategory: "info", confidence: 0.91 },
        { category: "info", verdict: "right", confidence: 0.92 },
        {
          category: "info",
          verdict: "wrong",
          trueCategory: "spam",
          confidence: 0.93,
          fields: { model_category: "urgent" },
        },
        { category: "notification", verdict: "wrong", confidence: 0.8 },
      ]);
      const byConfidence = (c: number) => predictions.find((p) => p.confidence === c);

      expect(predictions).toHaveLength(4);
      expect(byConfidence(0.91)).toEqual({
        expected: "info",
        predicted: "info",
        modelCategory: "info",
        confidence: 0.91,
        source: "llm",
      });
      expect(byConfidence(0.92)).toEqual({
        expected: "info",
        predicted: "info",
        modelCategory: "info",
        confidence: 0.92,
        source: "llm",
      });
      expect(byConfidence(0.93)).toEqual({
        expected: "spam",
        predicted: "info",
        modelCategory: "urgent",
        confidence: 0.93,
        source: "llm",
      });
      expect(byConfidence(0.8)).toEqual({
        expected: null,
        predicted: "notification",
        modelCategory: "notification",
        confidence: 0.8,
        source: "llm",
        wrongOnly: true,
      });
    });
  });

  test("a wrong verdict with no true category on a stored unsure row gives no prediction", async () => {
    await withRollback(db, async (trx) => {
      const tenant = await createOrgWithMailbox(trx);
      const { labeled, predictions } = await predictionsFor(trx, tenant, [
        { category: "unsure", verdict: "wrong", confidence: 0.3, fields: { model_category: "info" } },
        { category: "unsure", verdict: "wrong", trueCategory: "info", confidence: 0.4 },
        { category: "unsure", verdict: "right", confidence: 0.2 },
      ]);

      expect(labeled).toHaveLength(3);
      expect(predictions.map((p) => p.confidence).sort()).toEqual([0.2, 0.4]);
    });
  });

  test("a wrong verdict with no true category on a triage_error row stays as an error", async () => {
    await withRollback(db, async (trx) => {
      const tenant = await createOrgWithMailbox(trx);
      const { predictions } = await predictionsFor(trx, tenant, [
        { category: "unsure", verdict: "wrong", reasonCode: "triage_error", model: null, confidence: 0.5 },
      ]);

      expect(predictions).toHaveLength(1);
      expect(predictions[0]).toMatchObject({ source: "error", expected: null, wrongOnly: true });
    });
  });

  test("blocklist, triage_error and llm_blocked rows get their own source", async () => {
    await withRollback(db, async (trx) => {
      const tenant = await createOrgWithMailbox(trx);
      const { predictions } = await predictionsFor(trx, tenant, [
        { category: "spam", verdict: "right", reasonCode: "blocklist", model: null, confidence: 1 },
        { category: "unsure", verdict: "right", reasonCode: "triage_error", model: null, confidence: 0.55 },
        { category: "info", verdict: "right", reasonCode: "llm_blocked", model: null, confidence: 0.77 },
      ]);

      expect(predictions.find((p) => p.source === "rule")).toMatchObject({ expected: "spam", predicted: "spam" });
      expect(predictions.find((p) => p.source === "error")).toMatchObject({ predicted: "unsure", confidence: 0.55 });
      expect(predictions.find((p) => p.confidence === 0)).toEqual({
        expected: "info",
        predicted: "unsure",
        modelCategory: "unsure",
        confidence: 0,
        source: "llm",
      });
    });
  });

  test("synthetic labeled mail is not in the default (real) list", async () => {
    await withRollback(db, async (trx) => {
      const tenant = await createOrgWithMailbox(trx);
      await addLabeled(trx, tenant, { verdict: "right", messageId: "<s@ea-seed.test>" });
      await addLabeled(trx, tenant, { verdict: "right", messageId: "<r@x.test>" });

      const real = await listLabeledResults(trx, { orgId: tenant.orgId }, tenant.mailboxId, {
        mail: "real",
        testMail: NO_TEST_SENDERS,
      });
      expect(buildRealPredictions(real)).toHaveLength(1);
    });
  });
});

describe("buildRealReport", () => {
  test("a model filter keeps one model's rows and the counts show all rows", async () => {
    await withRollback(db, async (trx) => {
      const tenant = await createOrgWithMailbox(trx);
      const { labeled } = await predictionsFor(trx, tenant, [
        { category: "info", verdict: "right", model: "gemini-3.5-flash-lite" },
        { category: "info", verdict: "right", model: "gemini-3.5-flash-lite" },
        { category: "urgent", verdict: "right", model: "gpt-6-luna" },
        { category: "spam", verdict: "right", reasonCode: "blocklist", model: null, confidence: 1 },
      ]);
      const opts = { bar: 0.98, minKept: 30, mail: "real" as const, now: new Date("2026-11-06T12:00:00Z") };
      const counts = { "gemini-3.5-flash-lite": 2, "gpt-6-luna": 1, none: 1 };

      const all = buildRealReport(labeled, opts);
      expect(all.modelFilter).toBeNull();
      expect(all.labeled).toBe(4);
      expect(all.predictions).toHaveLength(4);
      expect(all.modelCounts).toEqual(counts);

      const filtered = buildRealReport(labeled, { ...opts, model: "gpt-6-luna" });
      expect(filtered.modelFilter).toBe("gpt-6-luna");
      expect(filtered.labeled).toBe(1);
      expect(filtered.predictions).toHaveLength(1);
      expect(filtered.modelCounts).toEqual(counts);
      expect(renderEvalReport(filtered)).toContain("- rows per model: gemini-3.5-flash-lite 2, gpt-6-luna 1, none 1");
    });
  });

  test("gives kind real, labeled = N, the error counts, and a warning under 100 labels", async () => {
    await withRollback(db, async (trx) => {
      const tenant = await createOrgWithMailbox(trx);
      const { labeled } = await predictionsFor(trx, tenant, [
        { category: "info", verdict: "right" },
        { category: "spam", verdict: "right", reasonCode: "blocklist", model: null, confidence: 1 },
        { category: "unsure", verdict: "right", reasonCode: "triage_error", model: null, confidence: 0 },
        { category: "unsure", verdict: "wrong", confidence: 0.3 },
      ]);
      const now = new Date("2026-11-05T12:00:00Z");
      const report = buildRealReport(labeled, { bar: 0.98, minKept: 30, mail: "real", now });

      expect(report.kind).toBe("real");
      expect(report.labeled).toBe(4);
      expect(report.startedAt).toEqual(now);
      expect(report.predictions).toHaveLength(3);
      expect(report.errors).toBe(1);
      expect(report.errorCodes).toEqual({ triage_error: 1 });
      expect(report.ruleSummary.error.total).toBe(report.errors);
      const markdown = renderEvalReport(report);
      expect(markdown).toContain("4 labeled real mails");
      expect(markdown).toContain("fewer than 100 real labels");
    });
  });
});
