import {
  DEFAULT_MAILS_PER_DAY,
  categories,
  computeMetrics,
  confidenceHistogram,
  confusionMatrix,
  costPerMail,
  goNoGo,
  monthlyCost,
  ruleSummary,
  thresholdSweep,
  type EvalCase,
  type Prediction,
} from "@ea/core";

import type { LlmProviderId } from "../../platform/llm";
import { createLog } from "../../platform/log";

import type { ClassifierExtras } from "./classifier";
import { isRuleSpam } from "./eval-case";
import { judgeFailed, judgeReusable, summarizeJudge, type JudgeSetup } from "./eval-judge";
import { BUDGET_STOP_REASON, runPool, type EvalBudget } from "./eval-pool";
import { toPrediction, type CaseResult, type CaseUsage, type CasesEvalReport } from "./eval-results";
import { judgeRow, runCase, type Deps } from "./eval-run-case";
import {
  optionalParts,
  versionHasParts,
  productionClassifierChoice,
  type ClassifierPromptChoice,
  type ClassifierPart,
} from "./prompts";

// The case types, the state-line parser and the case input builders live in `eval-results.ts` and `eval-case.ts`; callers keep importing them from here.
export {
  evalStateFileName,
  parseCaseResults,
  toPrediction,
  type CaseResult,
  type CaseUsage,
  type CasesEvalReport,
  type EvalReport,
  type EvalReportBase,
  type RealEvalReport,
} from "./eval-results";
export { delegateAddress, toClassifierInput } from "./eval-case";

const log = createLog("eval");

const STOP_AFTER_ERRORS = 3;

const STOP_REASON = "soft errors in a row (quota or overload), resume later";

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1] ?? null;
}

function countRight(results: (boolean | null)[]): { right: number; total: number } {
  const known = results.filter((value): value is boolean => value !== null);
  return { right: known.filter(Boolean).length, total: known.length };
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

// `done`: results from an earlier run. A result without an error (also a blocked one) is not run again.
// After STOP_AFTER_ERRORS LLM cases in a row end in an error, the run stops: a spent quota fails every call.
// `concurrency` calls run at once; with a `budget` the run also stops when the next call could pass the cap.
function promptPartsOf(choice: ClassifierPromptChoice): ClassifierPart[] | null {
  return versionHasParts(choice.version) ? optionalParts(choice.parts) : null;
}

export async function runEval(
  deps: Deps,
  input: {
    cases: EvalCase[];
    model: string;
    provider: LlmProviderId;
    // The host name of the server of the classifier (no path, no port). The endpoint kind comes from the client.
    host?: string | null;
    reasoningEffort?: string | null;
    bar: number;
    minKept: number;
    retries: number;
    done?: CaseResult[];
    concurrency?: number;
    budget?: EvalBudget;
    // With a judge, every planned delegation or clarification draft is judged.
    judge?: JudgeSetup;
    // The classifier prompt version and parts; absent: the production prompt.
    prompt?: ClassifierPromptChoice;
    extrasOf?: (c: EvalCase) => ClassifierExtras;
  }
): Promise<CasesEvalReport> {
  const startedAt = deps.now();
  // With a judge, a result is reused only when it needs no judge or holds scores; else the case runs again.
  const reusable = (r: CaseResult): boolean => r.errorCode === null && (input.judge === undefined || judgeReusable(r));
  const earlier = new Map((input.done ?? []).filter(reusable).map((r) => [r.id, r]));
  const pool = await runPool({
    cases: input.cases,
    earlier,
    concurrency: input.concurrency ?? 1,
    ...(input.budget === undefined ? {} : { budget: input.budget }),
    stopAfterErrors: STOP_AFTER_ERRORS,
    errorStopReason: STOP_REASON,
    now: startedAt,
    usesLlm: (c) => !isRuleSpam(c),
    // A spent judge quota fails every judge call: it stops the run like a classifier error.
    endedInError: (result) => result.errorCode !== null || judgeFailed(result.judge),
    run: (c, attempts) => runCase(deps, c, input, attempts),
    onResult: async (result) => {
      await deps.onResult?.(result);
      log.info("eval_case_done", {
        case_id: result.id,
        ...(result.finalCategory === null ? { error_code: result.errorCode } : { category: result.finalCategory }),
      });
    },
  });
  // The reason text is a sentence: the line carries one of its two names.
  if (pool.stoppedReason !== null) {
    log.warn("eval_stopped", { reason: pool.stoppedReason === BUDGET_STOP_REASON ? "budget_cap" : "error_streak" });
  }

  // The report follows the input order, never the finish order.
  const cases: CaseResult[] = [];
  const predictions: Prediction[] = [];
  const errorCodes: Record<string, number> = {};
  const whitelist = { passed: 0, total: 0, errors: 0 };
  const blockedIds: string[] = [];
  const usages: CaseUsage[] = [];
  for (const c of input.cases) {
    const result = pool.results.get(c.id);
    if (result === undefined) continue;
    const prediction = toPrediction(result);
    if (prediction) predictions.push(prediction);
    if (result.errorCode !== null) errorCodes[result.errorCode] = (errorCodes[result.errorCode] ?? 0) + 1;
    if (result.usage) usages.push(result.usage);
    if (result.blocked) blockedIds.push(result.id);
    if (result.whitelisted) {
      if (result.finalCategory !== null) {
        whitelist.total += 1;
        if (result.finalCategory !== "spam") whitelist.passed += 1;
      } else {
        whitelist.errors += 1;
      }
    }
    cases.push(result);
  }
  const stoppedReason = pool.stoppedReason;

  const injectionCases = cases.filter((r) => r.injectionPassed !== null);
  const sweep = {} as CasesEvalReport["sweep"];
  const histogram = {} as CasesEvalReport["histogram"];
  for (const category of categories) {
    sweep[category] = thresholdSweep(predictions, category);
    histogram[category] = confidenceHistogram(predictions, category);
  }

  const avgIn = average(usages.map((u) => u.tokensIn));
  const avgOut = average(usages.map((u) => u.tokensOut));
  const endpoint = deps.llm.endpointOf("classifier");
  const perMail =
    avgIn === null || avgOut === null ? null : costPerMail(input.model, avgIn, avgOut, startedAt, endpoint);
  const latencies = usages.map((u) => u.latencyMs).sort((a, b) => a - b);

  const judgeSummary = summarizeJudge(cases);
  return {
    kind: "cases",
    role: "classifier",
    bar: input.bar,
    minKept: input.minKept,
    startedAt,
    predictions,
    metrics: computeMetrics(predictions),
    confusion: confusionMatrix(predictions),
    sweep,
    goNoGo: goNoGo(predictions, { bar: input.bar, minKept: input.minKept }),
    ruleSummary: ruleSummary(predictions),
    histogram,
    errors: cases.filter((r) => r.errorCode !== null).length,
    errorCodes,
    model: input.model,
    provider: input.provider,
    endpoint,
    host: input.host ?? null,
    reasoningEffort: input.reasoningEffort ?? null,
    promptVersion: (input.prompt ?? productionClassifierChoice()).version,
    promptParts: promptPartsOf(input.prompt ?? productionClassifierChoice()),
    cases,
    cost: { spentUsd: pool.spentUsd, capUsd: input.budget?.capUsd ?? null, stoppedByBudget: pool.stoppedByBudget },
    complete: stoppedReason === null,
    stoppedReason,
    doneCount: cases.filter((r) => r.errorCode === null).length,
    totalCount: input.cases.length,
    whitelist,
    injection: {
      passed: injectionCases.filter((r) => r.injectionPassed === true).length,
      total: injectionCases.length,
      failedIds: injectionCases.filter((r) => r.injectionPassed === false).map((r) => r.id),
    },
    blocked: { total: blockedIds.length, ids: blockedIds },
    delegation: {
      pick: countRight(cases.map((r) => r.delegatePick)),
      draft: countRight(cases.map((r) => r.draftMatches)),
    },
    judge: judgeSummary === null || input.judge === undefined ? null : { ...judgeSummary, ...judgeRow(input.judge) },
    usage: {
      avgTokensIn: avgIn,
      avgTokensOut: avgOut,
      latencyP50: percentile(latencies, 0.5),
      latencyP95: percentile(latencies, 0.95),
      costPerMail: perMail,
      monthlyCostAt200: perMail === null ? null : monthlyCost(perMail, DEFAULT_MAILS_PER_DAY),
    },
  };
}
