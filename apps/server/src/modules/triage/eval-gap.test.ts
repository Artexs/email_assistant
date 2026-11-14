import { categories, computeMetrics, type Prediction } from "@ea/core";
import { describe, expect, test } from "bun:test";

import type { RealEvalReport } from "./eval";
import { GapInputError, gateFileError, realCounts, realCountsSchema, renderGap } from "./eval-gap";
import type { GateFile } from "./eval-sim-report";

const row = (tp: number, fp: number, fn: number) => ({
  support: tp + fn,
  threshold: null,
  kept: 0,
  tp: 0,
  precision: null,
  wilsonLower: null,
  recall: null,
  decision: "go" as const,
  metrics: { tp, fp, fn, support: tp + fn },
});

function simFile(notification = row(200, 0, 0), spam = row(100, 2, 3)): GateFile {
  const empty = row(0, 0, 0);
  return {
    scenario: "lab-01",
    version: "1",
    manifestSha: null,
    audit: "pending",
    provisional: true,
    part: "holdout",
    date: "2026-11-14",
    role: "classifier",
    provider: "gemini",
    model: "m",
    reasoningEffort: null,
    promptVersion: "v2",
    bar: 0.98,
    minKept: 30,
    categories: { urgent: empty, needs_reply: empty, info: empty, notification, spam },
    urgentRecallBySource: {
      text: { n: 0, recall: null },
      vip: { n: 0, recall: null },
      context: { n: 0, recall: null },
    },
    injection: { passed: 0, total: 0 },
  };
}

function realOf(notification: { tp: number; fp: number; fn: number }, spam = { tp: 40, fp: 1, fn: 2 }) {
  const counts = (c: { tp: number; fp: number; fn: number }) => ({ ...c, support: c.tp + c.fn });
  const zero = { tp: 0, fp: 0, fn: 0, support: 0 };
  return realCountsSchema.parse({
    date: "2026-11-14",
    labeled: 100,
    categories: Object.fromEntries(
      categories.map((c) => [c, c === "notification" ? counts(notification) : c === "spam" ? counts(spam) : zero])
    ),
  });
}

const notificationRow = (markdown: string) => markdown.split("\n").find((l) => l.startsWith("| notification"));

describe("renderGap", () => {
  test("overlapping precision intervals: no gap", () => {
    const line = notificationRow(renderGap({ sim: simFile(), real: realOf({ tp: 28, fp: 2, fn: 1 }) }));
    expect(line).toContain("[0.9812, 1.0000]");
    expect(line).toContain("[0.7868, 0.9815]");
    expect(line).toEndWith("| no gap |");
  });

  test("disjoint intervals: gap", () => {
    const line = notificationRow(renderGap({ sim: simFile(), real: realOf({ tp: 20, fp: 10, fn: 0 }) }));
    expect(line).toContain("[0.4878, 0.8077]");
    expect(line).toEndWith("| gap |");
  });

  test("real tp + fp under 30: too few real labels, even when the intervals are apart", () => {
    const line = notificationRow(renderGap({ sim: simFile(), real: realOf({ tp: 10, fp: 5, fn: 0 }) }));
    expect(line).toContain("| 15 |");
    expect(line).toEndWith("| too few real labels |");
  });

  test("the report states the measure and lists both categories", () => {
    const markdown = renderGap({ sim: simFile(), real: realOf({ tp: 28, fp: 2, fn: 1 }) });
    expect(markdown).toContain("final category, no threshold");
    expect(markdown).toContain("| spam |");
  });

  test("a gate file without metrics throws a typed error that names the field", () => {
    const old = simFile();
    delete (old.categories.notification as { metrics?: unknown }).metrics;
    expect(() => renderGap({ sim: old, real: realOf({ tp: 28, fp: 2, fn: 1 }) })).toThrow(GapInputError);
    try {
      renderGap({ sim: old, real: realOf({ tp: 28, fp: 2, fn: 1 }) });
    } catch (error) {
      expect((error as GapInputError).field).toBe("categories.notification.metrics.tp");
    }
    expect(gateFileError(["categories", "notification", "metrics"]).field).toBe("categories.notification.metrics");
  });
});

describe("realCounts", () => {
  test("holds counts only: no email id, no address", () => {
    const predictions: Prediction[] = [
      { expected: "spam", predicted: "spam", modelCategory: "spam", confidence: 0.9, source: "llm" },
      { expected: "notification", predicted: "spam", modelCategory: "spam", confidence: 0.9, source: "llm" },
    ];
    // Row-level fields (ids, addresses) ride along on the report object, as the real report rows do.
    const report = {
      kind: "real",
      labeled: 2,
      startedAt: new Date("2026-11-14T10:00:00Z"),
      metrics: computeMetrics(predictions),
      predictions: predictions.map((p, i) => ({ ...p, emailId: `id-${i}`, from: "ceo@bank.example" })),
    } as unknown as RealEvalReport;
    const counts = realCounts(report);
    const json = JSON.stringify(counts);
    expect(json).not.toContain("id-0");
    expect(json).not.toContain("@");
    expect(counts.categories.spam).toEqual({ tp: 1, fp: 1, fn: 0, support: 1 });
    expect(counts.date).toBe("2026-11-14");
    expect(realCountsSchema.parse(counts)).toEqual(counts);
  });
});
