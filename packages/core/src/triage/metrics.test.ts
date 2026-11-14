import { describe, expect, test } from "bun:test";

import type { Category } from "./categories";
import {
  computeMetrics,
  confidenceHistogram,
  confusionMatrix,
  goNoGo,
  simGoNoGo,
  ruleSummary,
  THRESHOLDS,
  thresholdSweep,
  wilsonInterval,
  type Prediction,
} from "./metrics";

function llm(expected: Category | null, predicted: Category, confidence = 0.9, extra: Partial<Prediction> = {}) {
  return { expected, predicted, modelCategory: predicted, confidence, source: "llm", ...extra } as Prediction;
}

function many(count: number, make: () => Prediction): Prediction[] {
  return Array.from({ length: count }, make);
}

describe("computeMetrics", () => {
  test("counts tp, fp, fn, support, precision and recall", () => {
    const rows = [
      llm("spam", "spam"),
      llm("spam", "spam"),
      llm("spam", "info"),
      llm("info", "spam"),
      llm("info", "info"),
    ];
    const metrics = computeMetrics(rows);
    expect(metrics.spam).toEqual({ tp: 2, fp: 1, fn: 1, support: 3, precision: 2 / 3, recall: 2 / 3 });
    expect(metrics.info).toEqual({ tp: 1, fp: 1, fn: 1, support: 2, precision: 1 / 2, recall: 1 / 2 });
  });

  test("an empty category has null precision and recall", () => {
    const metrics = computeMetrics([llm("spam", "spam")]);
    expect(metrics.urgent).toEqual({ tp: 0, fp: 0, fn: 0, support: 0, precision: null, recall: null });
  });

  test("a wrongOnly row is a false positive of its predicted category only", () => {
    const metrics = computeMetrics([llm("info", "info"), llm(null, "info", 0.9, { wrongOnly: true })]);
    expect(metrics.info).toMatchObject({ tp: 1, fp: 1, fn: 0, support: 1, precision: 1 / 2, recall: 1 });
    expect(metrics.spam.fn).toBe(0);
  });

  test("a row with no known truth is left out", () => {
    const metrics = computeMetrics([llm(null, "info")]);
    expect(metrics.info.fp).toBe(0);
  });

  test("rule rows do not change the spam precision", () => {
    const rows = [llm("spam", "spam"), ...many(5, () => ({ ...llm("info", "spam", 1), source: "rule" }) as Prediction)];
    expect(computeMetrics(rows).spam).toMatchObject({ tp: 1, fp: 0, precision: 1 });
  });

  test("error rows are left out", () => {
    const rows = [llm("spam", "spam"), { ...llm("spam", "unsure", 0), source: "error" } as Prediction];
    expect(computeMetrics(rows).spam).toMatchObject({ support: 1, fn: 0, recall: 1 });
  });

  test("a blocked row lowers the spam recall and changes no precision", () => {
    const blocked = llm("spam", "unsure", 0);
    const metrics = computeMetrics([llm("spam", "spam"), blocked]);
    expect(metrics.spam).toMatchObject({ tp: 1, fp: 0, fn: 1, precision: 1, recall: 1 / 2 });
    expect(metrics.unsure.fp).toBe(0);
  });
});

describe("confusionMatrix", () => {
  test("counts llm rows by expected and predicted", () => {
    const rows = [
      llm("spam", "spam"),
      llm("spam", "info"),
      llm("spam", "unsure", 0),
      llm(null, "info", 0.9, { wrongOnly: true }),
      { ...llm("spam", "spam", 1), source: "rule" } as Prediction,
    ];
    const matrix = confusionMatrix(rows);
    expect(matrix.spam.spam).toBe(1);
    expect(matrix.spam.info).toBe(1);
    expect(matrix.spam.unsure).toBe(1);
    expect(matrix.info.info).toBe(0);
  });
});

describe("thresholdSweep", () => {
  test("keeps rows by model category and confidence", () => {
    const rows = [
      llm("spam", "spam", 0.96),
      llm("info", "spam", 0.7),
      llm("spam", "spam", 0.5),
      llm("spam", "info", 0.99),
    ];
    const sweep = thresholdSweep(rows, "spam");
    expect(sweep.map((point) => point.threshold)).toEqual(THRESHOLDS);
    expect(sweep[0]).toEqual({ threshold: 0.5, precision: 2 / 3, recall: 2 / 3, kept: 3 });
    const at95 = sweep.find((point) => point.threshold === 0.95);
    expect(at95).toEqual({ threshold: 0.95, precision: 1, recall: 1 / 3, kept: 1 });
  });

  test("a row below the threshold is not kept; an empty set has null precision", () => {
    const sweep = thresholdSweep([llm("spam", "spam", 0.6)], "spam");
    expect(sweep.find((point) => point.threshold === 0.65)).toEqual({
      threshold: 0.65,
      precision: null,
      recall: 0,
      kept: 0,
    });
  });

  test("wrongOnly rows count as kept false positives; unknown truth does not count", () => {
    const rows = [llm("info", "info"), llm(null, "info", 0.9, { wrongOnly: true }), llm(null, "info")];
    expect(thresholdSweep(rows, "info")[0]).toMatchObject({ kept: 2, precision: 1 / 2 });
  });

  test("rule, error and blocked rows are never in a sweep", () => {
    const rows = [
      llm("spam", "spam"),
      { ...llm("info", "spam", 1), source: "rule" } as Prediction,
      { ...llm("info", "spam", 1), source: "error" } as Prediction,
      llm("spam", "unsure", 0),
    ];
    expect(thresholdSweep(rows, "spam")[0]).toEqual({ threshold: 0.5, precision: 1, recall: 1 / 2, kept: 1 });
    expect(thresholdSweep(rows, "unsure")[0]?.kept).toBe(0);
  });
});

describe("goNoGo", () => {
  test("29 kept rows, all right: no-go: too few", () => {
    const rows = many(29, () => llm("spam", "spam"));
    expect(goNoGo(rows).spam).toEqual({
      threshold: null,
      precision: 1,
      recall: 1,
      kept: 29,
      decision: "no-go: too few",
    });
  });

  test("30 kept rows, all right: go at 0.5", () => {
    const rows = many(30, () => llm("spam", "spam"));
    expect(goNoGo(rows).spam).toEqual({ threshold: 0.5, precision: 1, recall: 1, kept: 30, decision: "go" });
  });

  test("a category with no rows is no-go: too few with null precision", () => {
    expect(goNoGo([]).urgent).toEqual({
      threshold: null,
      precision: null,
      recall: null,
      kept: 0,
      decision: "no-go: too few",
    });
  });

  const lateSet = [
    ...many(18, () => llm("spam", "spam", 0.88)),
    ...many(10, () => llm("info", "spam", 0.88)),
    ...many(12, () => llm("spam", "spam", 0.92)),
  ];

  test("precision reached only at a threshold with too few rows: no-go", () => {
    const result = goNoGo(lateSet).spam;
    expect(result.decision).toBe("no-go");
    expect(result.threshold).toBeNull();
    expect(result.kept).toBe(40);
    expect(result.precision).toBe(30 / 40);
  });

  test("minKept 1 accepts the small high threshold", () => {
    const result = goNoGo(lateSet, { minKept: 1 }).spam;
    expect(result).toMatchObject({ decision: "go", threshold: 0.9, precision: 1, kept: 12 });
  });

  test("goes at the first eligible threshold that meets the bar", () => {
    const rows = [...many(30, () => llm("spam", "spam", 0.85)), ...many(10, () => llm("info", "spam", 0.75))];
    expect(goNoGo(rows).spam).toMatchObject({ decision: "go", threshold: 0.8, precision: 1, kept: 30 });
    expect(goNoGo(rows, { minKept: 1 }).spam).toMatchObject({ decision: "go", threshold: 0.8 });
  });

  test("a custom bar changes the decision", () => {
    const rows = [...many(29, () => llm("spam", "spam")), llm("info", "spam")];
    expect(goNoGo(rows).spam.decision).toBe("no-go");
    expect(goNoGo(rows, { bar: 0.95 }).spam).toMatchObject({ decision: "go", threshold: 0.5, kept: 30 });
  });

  test("only the five bar categories are in the result", () => {
    expect(Object.keys(goNoGo([]))).toEqual(["urgent", "needs_reply", "info", "notification", "spam"]);
  });
});

describe("ruleSummary", () => {
  test("counts rule rows right and wrong, and error rows", () => {
    const rule = (extra: Partial<Prediction>) =>
      ({ ...llm("spam", "spam", 1), source: "rule", ...extra }) as Prediction;
    const rows = [
      rule({}),
      rule({ expected: "info" }),
      rule({ expected: null, wrongOnly: true }),
      rule({ expected: null }),
      { ...llm("spam", "unsure", 0), source: "error" } as Prediction,
      llm("spam", "spam"),
    ];
    expect(ruleSummary(rows)).toEqual({ rule: { total: 4, right: 1, wrong: 2 }, error: { total: 1 } });
  });
});

describe("confidenceHistogram", () => {
  test("puts the edge values in the right bucket", () => {
    const rows = [0.495, 0.5, 0.59, 0.6, 0.9, 0.94, 0.95, 1].map((c) => llm("spam", "spam", c));
    const histogram = confidenceHistogram(rows, "spam");
    expect(histogram.map((entry) => entry.bucket)).toEqual([
      "0.00–0.49",
      "0.50–0.59",
      "0.60–0.69",
      "0.70–0.79",
      "0.80–0.89",
      "0.90–0.94",
      "0.95–1.00",
    ]);
    expect(histogram.map((entry) => entry.total)).toEqual([1, 2, 1, 0, 0, 2, 2]);
  });

  test("counts correct rows and uses only llm rows of the model category", () => {
    const rows = [
      llm("spam", "spam", 0.97),
      llm("info", "spam", 0.97),
      llm("spam", "info", 0.97),
      { ...llm("spam", "spam", 1), source: "rule" } as Prediction,
    ];
    expect(confidenceHistogram(rows, "spam")[6]).toEqual({ bucket: "0.95–1.00", total: 2, correct: 1 });
  });
});

describe("wilsonInterval", () => {
  test("n = 0 knows nothing", () => {
    expect(wilsonInterval(0, 0)).toEqual({ lower: 0, upper: 1 });
  });

  test("10 of 10", () => {
    const { lower, upper } = wilsonInterval(10, 10);
    expect(Math.abs(lower - 0.7225)).toBeLessThan(0.0005);
    expect(upper).toBe(1);
  });

  test("189 of 189", () => {
    expect(wilsonInterval(189, 189).lower).toBeGreaterThanOrEqual(0.98);
  });

  test("5 of 10", () => {
    const { lower, upper } = wilsonInterval(5, 10);
    expect(Math.abs(lower - 0.2366)).toBeLessThan(0.0005);
    expect(Math.abs(upper - 0.7634)).toBeLessThan(0.0005);
  });
});

describe("wilsonInterval, plan numbers", () => {
  test("lower bounds of full and near-full runs", () => {
    expect(wilsonInterval(200, 200).lower).toBeCloseTo(0.9812, 4);
    expect(wilsonInterval(199, 200).lower).toBeCloseTo(0.9722, 4);
    expect(wilsonInterval(190, 190).lower).toBeCloseTo(0.9802, 4);
    expect(wilsonInterval(185, 185).lower).toBeCloseTo(0.9797, 4);
  });
});

describe("simGoNoGo", () => {
  const notifications = (count: number) => many(count, () => llm("notification", "notification", 0.95));

  test("200 right notifications are go at 0.5 with Wilson lower 0.9812", () => {
    const row = simGoNoGo(notifications(200)).notification;
    expect(row.decision).toBe("go");
    expect(row.threshold).toBe(0.5);
    expect(row.support).toBe(200);
    expect(row.tp).toBe(200);
    expect(row.wilsonLower).toBeCloseTo(0.9812, 4);
  });

  test("one false positive makes it no-go (200 of 201, lower 0.9724)", () => {
    const rows = [...notifications(200), llm("info", "notification", 0.95)];
    const row = simGoNoGo(rows).notification;
    expect(row.decision).toBe("no-go");
    expect(row.threshold).toBeNull();
    expect(row.kept).toBe(201);
    expect(row.wilsonLower).toBeCloseTo(0.9724, 4);
  });

  test("199 rows of support are too few", () => {
    const row = simGoNoGo(notifications(199)).notification;
    expect(row.decision).toBe("no-go: too few");
    expect(row.threshold).toBeNull();
    expect(row.support).toBe(199);
  });

  test("a category with no rows is too few with null numbers", () => {
    const row = simGoNoGo([]).urgent;
    expect(row).toMatchObject({ decision: "no-go: too few", support: 0, kept: 0, precision: null, wilsonLower: null });
  });

  test("a higher threshold can reach go when low-confidence errors drop out", () => {
    const rows = [...notifications(200), ...many(5, () => llm("info", "notification", 0.55))];
    const row = simGoNoGo(rows).notification;
    expect(row.decision).toBe("go");
    expect(row.threshold).toBe(0.6);
  });
});
