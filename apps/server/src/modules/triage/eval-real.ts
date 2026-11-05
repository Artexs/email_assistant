import {
  categories,
  confidenceHistogram,
  computeMetrics,
  confusionMatrix,
  goNoGo,
  type Prediction,
  ruleSummary,
  thresholdSweep,
} from "@ea/core";

import type { RealEvalReport } from "./eval";
import type { listLabeledResults, MailKind } from "./repo";

type LabeledRows = Awaited<ReturnType<typeof listLabeledResults>>;

function modelCategoryOf(fields: unknown): unknown {
  return typeof fields === "object" && fields !== null && !Array.isArray(fields)
    ? (fields as Record<string, unknown>).model_category
    : undefined;
}

function sourceOfRow(row: LabeledRows[number]): Prediction["source"] {
  if (row.model !== null) return "llm";
  if (row.reason_code === "blocklist") return "rule";
  return row.reason_code === "triage_error" ? "error" : "llm";
}

// A row without a model is a rule result, a triage error, or a blocked LLM call (user answer Q28: predicted `unsure`).
function sourceOf(row: LabeledRows[number]): Pick<Prediction, "source" | "predicted" | "modelCategory" | "confidence"> {
  if (row.model === null && row.reason_code === "llm_blocked") {
    return { source: "llm", predicted: "unsure", modelCategory: "unsure", confidence: 0 };
  }
  const modelCategory = categories.find((c) => c === modelCategoryOf(row.fields)) ?? row.category;
  return { source: sourceOfRow(row), predicted: row.category, modelCategory, confidence: row.confidence };
}

export function buildRealPredictions(rows: LabeledRows): Prediction[] {
  const predictions: Prediction[] = [];
  for (const row of rows) {
    const wrongOnly = row.verdict === "wrong" && row.true_category === null;
    // The "wrong" verdict of a below-threshold row is about `unsure`, not about the model guess (user 2026-11-05).
    if (wrongOnly && row.category === "unsure" && row.model !== null) continue;
    const expected = row.true_category ?? (row.verdict === "right" ? row.category : null);
    predictions.push({ expected, ...sourceOf(row), ...(wrongOnly ? { wrongOnly: true } : {}) });
  }
  return predictions;
}

export function buildRealReport(
  rows: LabeledRows,
  opts: { bar: number; minKept: number; mail: MailKind; now: Date }
): RealEvalReport {
  const predictions = buildRealPredictions(rows);
  const sweep = {} as RealEvalReport["sweep"];
  const histogram = {} as RealEvalReport["histogram"];
  for (const category of categories) {
    sweep[category] = thresholdSweep(predictions, category);
    histogram[category] = confidenceHistogram(predictions, category);
  }
  const errors = predictions.filter((p) => p.source === "error").length;
  return {
    kind: "real",
    mail: opts.mail,
    labeled: rows.length,
    bar: opts.bar,
    minKept: opts.minKept,
    startedAt: opts.now,
    predictions,
    metrics: computeMetrics(predictions),
    confusion: confusionMatrix(predictions),
    sweep,
    goNoGo: goNoGo(predictions, { bar: opts.bar, minKept: opts.minKept }),
    ruleSummary: ruleSummary(predictions),
    histogram,
    errors,
    errorCodes: errors > 0 ? { triage_error: errors } : {},
  };
}
