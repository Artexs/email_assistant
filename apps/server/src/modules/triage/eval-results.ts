import {
  categories,
  computeMetrics,
  confidenceHistogram,
  confusionMatrix,
  draftCheckCodes,
  goNoGo,
  ruleSummary,
  thresholdSweep,
  type Category,
  type LlmEndpointKind,
  type LlmRole,
  type Prediction,
} from "@ea/core";
import { z } from "zod";

import type { LlmProviderId, LlmUsage } from "../../platform/llm";

import type { DraftKind } from "./eval-case";
import { endpointSuffix } from "./eval-format";
import { summarizeJudge, type CaseJudge } from "./eval-judge";
import type { ClassifierV3Part } from "./prompts";
import type { MailKind } from "./repo";

// The usage of one eval case. State files of earlier runs have no role or prompt version.
export type CaseUsage = Pick<LlmUsage, "model" | "tokensIn" | "tokensOut" | "latencyMs">;

export interface CaseResult {
  id: string;
  kind: "synthetic" | "injection";
  expected: Category;
  modelCategory: Category | null;
  finalCategory: Category | null;
  confidence: number | null;
  source: "llm" | "rule";
  whitelisted: boolean;
  blocked: boolean;
  usage: CaseUsage | null;
  errorCode: string | null;
  plannedTypes: string[];
  injectionPassed: boolean | null;
  // Null when the case expects no delegate, or the case ended in an error.
  delegatePick: boolean | null;
  draftKind: DraftKind | null;
  draftMatches: boolean | null;
  // The draft judge result (`eval --sim --judge`); null when no judge ran or no draft was planned.
  judge: CaseJudge;
  // The usage of the judge call: its cost counts in the budget.
  judgeUsage: CaseUsage | null;
}

export interface EvalReportBase {
  // The role whose prompt and model this report measures.
  role: LlmRole;
  bar: number;
  minKept: number;
  startedAt: Date;
  predictions: Prediction[];
  metrics: ReturnType<typeof computeMetrics>;
  confusion: ReturnType<typeof confusionMatrix>;
  sweep: Record<Category, ReturnType<typeof thresholdSweep>>;
  goNoGo: ReturnType<typeof goNoGo>;
  ruleSummary: ReturnType<typeof ruleSummary>;
  histogram: Record<Category, ReturnType<typeof confidenceHistogram>>;
  errors: number;
  errorCodes: Record<string, number>;
}

export interface CasesEvalReport extends EvalReportBase {
  kind: "cases";
  model: string;
  provider: LlmProviderId;
  // Where the calls ran and the host name of the server (null: the provider default, Gemini). No path, no port.
  endpoint: LlmEndpointKind;
  host: string | null;
  reasoningEffort: string | null;
  promptVersion: string;
  // The optional parts of a `classifier-v3` run in the type's order; null for another version (stage 08).
  promptParts: ClassifierV3Part[] | null;
  cases: CaseResult[];
  // Spend of the earlier results and the new ones, by the run's price table. Zero without a budget.
  cost: { spentUsd: number; capUsd: number | null; stoppedByBudget: boolean };
  complete: boolean;
  stoppedReason: string | null;
  doneCount: number;
  totalCount: number;
  whitelist: { passed: number; total: number; errors: number };
  injection: { passed: number; total: number; failedIds: string[] };
  blocked: { total: number; ids: string[] };
  delegation: { pick: { right: number; total: number }; draft: { right: number; total: number } };
  // Null without `--judge`, or when no case holds a judge result. Names the judge row of the run.
  judge: (NonNullable<ReturnType<typeof summarizeJudge>> & { provider: LlmProviderId; model: string }) | null;
  usage: {
    avgTokensIn: number | null;
    avgTokensOut: number | null;
    latencyP50: number | null;
    latencyP95: number | null;
    costPerMail: number | null;
    monthlyCostAt200: number | null;
  };
}

export interface RealEvalReport extends EvalReportBase {
  kind: "real";
  mail: MailKind;
  labeled: number;
  modelFilter: string | null;
  modelCounts: Record<string, number>;
}

export type EvalReport = CasesEvalReport | RealEvalReport;

// The state file of one run. Gemini has no effort, so its names stay as before.
// The endpoint is part of the name: a resume never takes the results of another endpoint (F111 D8). A run with an
// explicit `--state` path skips this function, so the endpoint is the caller's duty there.
export function evalStateFileName(opts: {
  model: string;
  endpoint: LlmEndpointKind;
  reasoningEffort: string | null;
  // A `promptLabel` (`classifier-v3[history,urgency]`) keeps two variants apart; its brackets and commas become `_`.
  promptVersion: string;
  set: string;
  perCategory?: number;
}): string {
  const effort = opts.reasoningEffort === null ? "" : `-${opts.reasoningEffort}`;
  const perCategory = opts.perCategory === undefined ? "" : `-pc${opts.perCategory}`;
  const version = opts.promptVersion.replace(/[^\w.-]/g, "_");
  return `${opts.model.replace(/[^\w.-]/g, "_")}${effort}-${version}-${opts.set}${perCategory}${endpointSuffix(opts.endpoint)}.jsonl`;
}

// One state line. It holds no case text: ids, categories, numbers and codes only.
const caseResultSchema = z.object({
  id: z.string(),
  kind: z.enum(["synthetic", "injection"]),
  expected: z.enum(categories),
  modelCategory: z.enum(categories).nullable(),
  finalCategory: z.enum(categories).nullable(),
  confidence: z.number().nullable(),
  source: z.enum(["llm", "rule"]),
  whitelisted: z.boolean(),
  blocked: z.boolean(),
  usage: z.object({ model: z.string(), tokensIn: z.number(), tokensOut: z.number(), latencyMs: z.number() }).nullable(),
  errorCode: z.string().nullable(),
  plannedTypes: z.array(z.string()),
  injectionPassed: z.boolean().nullable(),
  delegatePick: z.boolean().nullable().default(null),
  draftKind: z.enum(["delegation", "clarification", "none"]).nullable().default(null),
  draftMatches: z.boolean().nullable().default(null),
  judge: z
    .union([
      z.object({
        kind: z.literal("delegation"),
        codeFailed: z.array(z.enum(draftCheckCodes)),
        scores: z.record(z.string(), z.number()),
        checks: z.record(z.string(), z.boolean()),
        passed: z.boolean(),
      }),
      z.object({ kind: z.literal("delegation"), errorCode: z.string() }),
    ])
    .nullable()
    .default(null),
  judgeUsage: z
    .object({ model: z.string(), tokensIn: z.number(), tokensOut: z.number(), latencyMs: z.number() })
    .nullable()
    .default(null),
});

// Later lines win. A line that does not parse (for example a cut write) is skipped.
export function parseCaseResults(text: string): CaseResult[] {
  const byId = new Map<string, CaseResult>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = caseResultSchema.safeParse(JSON.parse(line));
      if (parsed.success) byId.set(parsed.data.id, parsed.data);
    } catch {
      continue;
    }
  }
  return [...byId.values()];
}

// The same mapping for a new result and for one read from the state. An error has no prediction.
export function toPrediction(r: CaseResult): Prediction | null {
  if (r.errorCode !== null || r.finalCategory === null) return null;
  if (r.source === "rule") {
    return { expected: r.expected, predicted: r.finalCategory, modelCategory: "spam", confidence: 1, source: "rule" };
  }
  return {
    expected: r.expected,
    predicted: r.finalCategory,
    modelCategory: r.modelCategory ?? "unsure",
    confidence: r.confidence ?? 0,
    source: "llm",
  };
}
