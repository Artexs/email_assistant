import { categories, type Category } from "./categories";

export interface Prediction {
  expected: Category | null;
  predicted: Category;
  modelCategory: Category;
  confidence: number;
  source: "llm" | "rule" | "error";
  // Feedback said "wrong" with no true category.
  wrongOnly?: boolean;
}

export interface CategoryMetrics {
  tp: number;
  fp: number;
  fn: number;
  support: number;
  precision: number | null;
  recall: number | null;
}

export const THRESHOLDS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];

export const barCategories = ["urgent", "needs_reply", "info", "notification", "spam"] as const;
export type BarCategory = (typeof barCategories)[number];

export interface SweepPoint {
  threshold: number;
  precision: number | null;
  recall: number | null;
  kept: number;
}

export type GoDecision = "go" | "no-go" | "no-go: too few";

export interface GoNoGoRow {
  threshold: number | null;
  precision: number | null;
  recall: number | null;
  kept: number;
  decision: GoDecision;
}

const DEFAULT_BAR = 0.98;
const DEFAULT_MIN_KEPT = 30;

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

const llmRows = (rows: Prediction[]): Prediction[] => rows.filter((row) => row.source === "llm");

// A row whose true category is unknown and that has no "wrong" verdict says nothing about quality.
const hasTruth = (row: Prediction): boolean => row.expected !== null || row.wrongOnly === true;

export function computeMetrics(rows: Prediction[]): Record<Category, CategoryMetrics> {
  const result = {} as Record<Category, CategoryMetrics>;
  const known = llmRows(rows).filter(hasTruth);
  for (const category of categories) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let support = 0;
    for (const row of known) {
      if (row.expected === category) {
        support += 1;
        if (row.predicted === category) tp += 1;
        else fn += 1;
      } else if (row.predicted === category && category !== "unsure") {
        fp += 1;
      }
    }
    result[category] = { tp, fp, fn, support, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) };
  }
  return result;
}

export function confusionMatrix(rows: Prediction[]): Record<Category, Record<Category, number>> {
  const matrix = {} as Record<Category, Record<Category, number>>;
  for (const expected of categories) {
    matrix[expected] = {} as Record<Category, number>;
    for (const predicted of categories) matrix[expected][predicted] = 0;
  }
  for (const row of llmRows(rows)) {
    if (row.expected !== null) matrix[row.expected][row.predicted] += 1;
  }
  return matrix;
}

export function thresholdSweep(rows: Prediction[], category: Category, thresholds = THRESHOLDS): SweepPoint[] {
  const llm = llmRows(rows);
  const expectedCount = llm.filter((row) => row.expected === category).length;
  return thresholds.map((threshold) => {
    const kept = llm.filter((row) => row.modelCategory === category && row.confidence >= threshold && hasTruth(row));
    const tp = kept.filter((row) => row.expected === category).length;
    return { threshold, precision: ratio(tp, kept.length), recall: ratio(tp, expectedCount), kept: kept.length };
  });
}

export function goNoGo(
  rows: Prediction[],
  opts: { bar?: number; minKept?: number } = {}
): Record<BarCategory, GoNoGoRow> {
  const bar = opts.bar ?? DEFAULT_BAR;
  const minKept = opts.minKept ?? DEFAULT_MIN_KEPT;
  const result = {} as Record<BarCategory, GoNoGoRow>;
  for (const category of barCategories) {
    const sweep = thresholdSweep(rows, category);
    const eligible = sweep.filter((point) => point.kept >= minKept);
    const first = eligible[0];
    if (!first) {
      const lowest = sweep[0] as SweepPoint;
      result[category] = { ...lowest, threshold: null, decision: "no-go: too few" };
      continue;
    }
    const passing = eligible.find((point) => point.precision !== null && point.precision >= bar);
    if (passing) {
      result[category] = { ...passing, decision: "go" };
    } else {
      result[category] = { ...first, threshold: null, decision: "no-go" };
    }
  }
  return result;
}

export function ruleSummary(rows: Prediction[]): {
  rule: { total: number; right: number; wrong: number };
  error: { total: number };
} {
  const rule = { total: 0, right: 0, wrong: 0 };
  let errors = 0;
  for (const row of rows) {
    if (row.source === "error") errors += 1;
    if (row.source !== "rule") continue;
    rule.total += 1;
    if (row.expected !== null && row.expected === row.predicted) rule.right += 1;
    else if (row.wrongOnly === true || (row.expected !== null && row.expected !== row.predicted)) rule.wrong += 1;
  }
  return { rule, error: { total: errors } };
}

const bucketLabels = ["0.00–0.49", "0.50–0.59", "0.60–0.69", "0.70–0.79", "0.80–0.89", "0.90–0.94", "0.95–1.00"];
const bucketStarts = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95];

export function confidenceHistogram(
  rows: Prediction[],
  category: Category
): { bucket: string; total: number; correct: number }[] {
  const buckets = bucketLabels.map((bucket) => ({ bucket, total: 0, correct: 0 }));
  for (const row of llmRows(rows)) {
    if (row.modelCategory !== category) continue;
    let index = 0;
    bucketStarts.forEach((start, i) => {
      if (row.confidence >= start) index = i;
    });
    const entry = buckets[index] as { bucket: string; total: number; correct: number };
    entry.total += 1;
    if (row.expected === category) entry.correct += 1;
  }
  return buckets;
}

// The Wilson score interval of `successes` out of `n`, clamped to [0, 1]. `n = 0` knows nothing: [0, 1].
export function wilsonInterval(successes: number, n: number, z = 1.959964): { lower: number; upper: number } {
  if (n <= 0) return { lower: 0, upper: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  // At the edges the bound is exact; the formula only gives it up to rounding.
  return {
    lower: successes <= 0 ? 0 : Math.max(0, center - margin),
    upper: successes >= n ? 1 : Math.min(1, center + margin),
  };
}

export interface SimGateRow {
  support: number;
  threshold: number | null;
  kept: number;
  tp: number;
  precision: number | null;
  wilsonLower: number | null;
  recall: number | null;
  decision: GoDecision;
}

// Rows of a category in the lab corpus that the gate needs before it can say "go" (D24).
export const SIM_MIN_SUPPORT = 200;

// The sim gate (D23, D24): the Wilson 95 % lower bound of the precision must reach the bar, not the point value.
export function simGoNoGo(
  rows: Prediction[],
  opts: { bar?: number; minSupport?: number; minKept?: number } = {}
): Record<BarCategory, SimGateRow> {
  const bar = opts.bar ?? DEFAULT_BAR;
  const minSupport = opts.minSupport ?? SIM_MIN_SUPPORT;
  const minKept = opts.minKept ?? DEFAULT_MIN_KEPT;
  const llm = llmRows(rows);
  const result = {} as Record<BarCategory, SimGateRow>;
  for (const category of barCategories) {
    const support = llm.filter((row) => row.expected === category).length;
    const points = THRESHOLDS.map((threshold) => {
      const keptRows = llm.filter(
        (row) => row.modelCategory === category && row.confidence >= threshold && hasTruth(row)
      );
      const tp = keptRows.filter((row) => row.expected === category).length;
      const kept = keptRows.length;
      return {
        support,
        threshold: threshold as number | null,
        kept,
        tp,
        precision: ratio(tp, kept),
        wilsonLower: kept === 0 ? null : wilsonInterval(tp, kept).lower,
        recall: ratio(tp, support),
        decision: "no-go" as GoDecision,
      };
    });
    const lowest = points[0] as SimGateRow;
    if (support < minSupport) {
      result[category] = { ...lowest, threshold: null, decision: "no-go: too few" };
      continue;
    }
    const eligible = points.filter((point) => point.kept >= minKept);
    const passing = eligible.find((point) => point.wilsonLower !== null && point.wilsonLower >= bar);
    if (passing) result[category] = { ...passing, decision: "go" };
    else result[category] = { ...(eligible[0] ?? lowest), threshold: null, decision: "no-go" };
  }
  return result;
}
