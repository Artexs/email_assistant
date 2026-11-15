import {
  categories,
  computeMetrics,
  missedImportant,
  urgencySources,
  wilsonInterval,
  type Category,
  type MailTruthRow,
  type MissedImportant,
  type Prediction,
  type UrgencySource,
} from "@ea/core";

import type { ScoredMail } from "./join";

export interface Interval {
  lower: number;
  upper: number;
}

export interface CategoryScore {
  support: number;
  // Mails predicted as this category (tp + fp; for `unsure`, the mails the assistant left unsure).
  predicted: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  precisionInterval: Interval | null;
  recallInterval: Interval | null;
}

export interface RecallCount {
  support: number;
  tp: number;
  recall: number | null;
}

export interface TriageScore {
  // Rows with a prediction: the only rows that precision and recall use.
  scored: number;
  // Rows left out, as counts: no mail row, no result, or a skip code of the injector.
  missing: { notSynced: number; notTriaged: number; skipped: Record<string, number> };
  perCategory: Record<Category, CategoryScore>;
  falseNegativeRate: { urgent: number | null; needs_reply: number | null };
  urgentRecallBySource: Record<UrgencySource, RecallCount>;
  recallByHardCase: Record<string, RecallCount>;
}

type Scored = ScoredMail & { emailId: string; predicted: Category };

const isScored = (row: ScoredMail): row is Scored => row.emailId !== null && row.predicted !== null;

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

const recallCount = (rows: readonly Scored[]): RecallCount => {
  const tp = rows.filter((row) => row.predicted === row.truth).length;
  return { support: rows.length, tp, recall: ratio(tp, rows.length) };
};

/** Per-category counts, precision and recall with their Wilson 95 % intervals, from the one `computeMetrics` of core. */
export function scoreTriage(rows: readonly ScoredMail[]): TriageScore {
  const scored = rows.filter(isScored);
  const missing: TriageScore["missing"] = { notSynced: 0, notTriaged: 0, skipped: {} };
  for (const row of rows) {
    if (isScored(row) || row.skipped === undefined) continue;
    if (row.skipped === "not_synced") missing.notSynced += 1;
    else if (row.skipped === "not_triaged") missing.notTriaged += 1;
    else missing.skipped[row.skipped] = (missing.skipped[row.skipped] ?? 0) + 1;
  }

  // The lab is the `llm` path of the metric: the slot is the truth, the stored result is the prediction.
  const predictions: Prediction[] = scored.map((row) => ({
    expected: row.truth,
    predicted: row.predicted,
    modelCategory: row.predicted,
    confidence: 1,
    source: "llm",
  }));
  const metrics = computeMetrics(predictions);
  const perCategory = {} as Record<Category, CategoryScore>;
  for (const category of categories) {
    const m = metrics[category];
    const predicted = scored.filter((row) => row.predicted === category).length;
    perCategory[category] = {
      ...m,
      predicted,
      precisionInterval: m.tp + m.fp === 0 ? null : wilsonInterval(m.tp, m.tp + m.fp),
      recallInterval: m.support === 0 ? null : wilsonInterval(m.tp, m.support),
    };
  }

  const urgentRecallBySource = {} as Record<UrgencySource, RecallCount>;
  for (const source of urgencySources) {
    urgentRecallBySource[source] = recallCount(
      scored.filter((row) => row.truth === "urgent" && row.urgencySource === source)
    );
  }
  const recallByHardCase: Record<string, RecallCount> = {};
  for (const tag of [...new Set(scored.flatMap((row) => row.hardCases))].sort()) {
    recallByHardCase[tag] = recallCount(scored.filter((row) => row.hardCases.includes(tag)));
  }

  return {
    scored: scored.length,
    missing,
    perCategory,
    falseNegativeRate: {
      urgent: ratio(perCategory.urgent.fn, perCategory.urgent.support),
      needs_reply: ratio(perCategory.needs_reply.fn, perCategory.needs_reply.support),
    },
    urgentRecallBySource,
    recallByHardCase,
  };
}

/**
 * M1 by the core `missedImportant`: one row per scored mail, with the slot category as the truth. The truth source is
 * null and `wrongOnly` is false, so a slot is important by its own category and a miss follows the core rule.
 */
export function scoreM1(rows: readonly ScoredMail[]): MissedImportant {
  const truthRows: MailTruthRow[] = rows.filter(isScored).map((row) => ({
    emailId: row.emailId,
    predicted: row.predicted,
    truth: row.truth,
    truthSource: null,
    wrongOnly: false,
  }));
  return missedImportant(truthRows);
}
