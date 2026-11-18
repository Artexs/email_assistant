import { decideCategory, planActions, type Category, type EvalCase } from "@ea/core";

import { SoftError } from "../../platform/errors";
import {
  LlmBlockedError,
  LlmConfigError,
  LlmOutputError,
  llmErrorCode,
  type LlmClient,
  type LlmProviderId,
  type LlmUsage,
} from "../../platform/llm";
import { createLog } from "../../platform/log";

import { classifyEmail, type ClassifierExtras } from "./classifier";
import {
  delegationResult,
  injectionHolds,
  planDelegationInput,
  rulesOf,
  toClassifierDelegates,
  toClassifierInput,
} from "./eval-case";
import { judgeCaseDraft, type JudgeSetup } from "./eval-judge";
import { RETRY_WAITS_MS, type AttemptHooks } from "./eval-pool";
import type { CaseResult, CaseUsage } from "./eval-results";
import type { ClassifierPromptChoice } from "./prompts";

const log = createLog("eval");

export interface Deps {
  llm: LlmClient;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  // Called once for each new result (not for results from `done`). The CLI appends it to the state file.
  onResult?: (result: CaseResult) => Promise<void>;
  // Called for each case that ends in an error. `issues` holds `path:code` entries of a bad model output, never model text.
  onCaseFailed?: (failure: { caseId: string; code: string; issues: readonly string[] }) => void;
}

// What one case run reads from the eval input.
interface RunInput {
  model: string;
  retries: number;
  // Absent: the production prompt.
  prompt?: ClassifierPromptChoice;
  // The extras of a case (stage 08); absent: none.
  extrasOf?: (c: EvalCase) => ClassifierExtras;
}

type Answer = Awaited<ReturnType<typeof classifyEmail>>;

type Classified =
  | { kind: "ok"; result: Answer }
  | { kind: "blocked" }
  | { kind: "error"; code: string; issues: readonly string[] };

// Soft errors: wait and try again, at most `retries` more tries. A config error goes to the caller.
async function withRetry(
  deps: Deps,
  c: EvalCase,
  input: RunInput,
  attempts: AttemptHooks | undefined,
  call: () => Promise<Answer>
): Promise<Classified> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return { kind: "ok", result: await call() };
    } catch (error) {
      if (error instanceof LlmConfigError) throw error;
      // Every other failed attempt may be billed: the pool charges it, and may refuse the retry at the cap.
      attempts?.failed();
      if (error instanceof LlmBlockedError) return { kind: "blocked" };
      if (error instanceof SoftError && attempt < input.retries && (attempts?.mayRetry() ?? true)) {
        const wait = RETRY_WAITS_MS[Math.min(attempt, RETRY_WAITS_MS.length - 1)] as number;
        log.warn("eval_case_retry", { case_id: c.id, attempts: attempt + 1, wait_ms: wait });
        await deps.sleep(wait);
        continue;
      }
      return { kind: "error", code: llmErrorCode(error), issues: error instanceof LlmOutputError ? error.issues : [] };
    }
  }
}

function classifyWithRetry(
  deps: Deps,
  c: EvalCase,
  allowed: Category[],
  sender: { whitelisted: boolean; vip: boolean; noreply: boolean },
  input: RunInput,
  attempts?: AttemptHooks
): Promise<Classified> {
  return withRetry(deps, c, input, attempts, () =>
    classifyEmail(deps.llm, {
      email: toClassifierInput(c),
      sender,
      allowed,
      delegates: toClassifierDelegates(c),
      model: input.model,
      ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
      ...(input.extrasOf === undefined ? {} : { extras: input.extrasOf(c) }),
    })
  );
}

export function judgeRow(setup: JudgeSetup): { provider: LlmProviderId; model: string } {
  return { provider: setup.provider, model: setup.model };
}

function caseUsage(usage: LlmUsage): CaseUsage {
  return { model: usage.model, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, latencyMs: usage.latencyMs };
}

export async function runCase(
  deps: Deps,
  c: EvalCase,
  input: RunInput & { judge?: JudgeSetup },
  attempts?: AttemptHooks
): Promise<CaseResult> {
  const expected = c.expected.category;
  const rules = rulesOf(c);
  const base = { id: c.id, kind: c.kind, expected };

  if (rules.kind === "spam") {
    const actions = planActions("spam", null);
    return {
      ...base,
      modelCategory: null,
      finalCategory: "spam",
      confidence: null,
      source: "rule",
      whitelisted: false,
      blocked: false,
      usage: null,
      errorCode: null,
      plannedTypes: actions.map((a) => a.type),
      injectionPassed: c.kind === "injection" ? injectionHolds(actions, c) : null,
      ...delegationResult(c, actions, null),
      judge: null,
      judgeUsage: null,
    };
  }

  const classified = await classifyWithRetry(
    deps,
    c,
    rules.allowed,
    { whitelisted: rules.whitelisted, vip: rules.vip, noreply: rules.noreply },
    input,
    attempts
  );
  if (classified.kind === "error") {
    // The log line holds the case id and the code. The issue paths (`fields.task:too_big`, no model text) go to the
    // hook: a comma list is not a log value (D7).
    log.warn("eval_case_failed", { case_id: c.id, code: classified.code });
    deps.onCaseFailed?.({ caseId: c.id, code: classified.code, issues: classified.issues });
    return {
      ...base,
      modelCategory: null,
      finalCategory: null,
      confidence: null,
      source: "llm",
      whitelisted: rules.whitelisted,
      blocked: false,
      usage: null,
      errorCode: classified.code,
      plannedTypes: [],
      injectionPassed: null,
      delegatePick: null,
      draftKind: null,
      draftMatches: null,
      judge: null,
      judgeUsage: null,
    };
  }
  const blocked = classified.kind === "blocked";
  const firstAnalysis = classified.kind === "ok" ? classified.result.analysis : null;
  const firstFinal = firstAnalysis ? decideCategory(firstAnalysis, {}) : null;
  const analysis = firstAnalysis;
  const finalCategory: Category = firstFinal?.category ?? "unsure";
  const actions = planActions(
    finalCategory,
    analysis?.summary ?? null,
    analysis && finalCategory === "delegation" ? (planDelegationInput(c, analysis) ?? undefined) : undefined
  );
  const judged =
    input.judge === undefined
      ? { judge: null, usage: null }
      : await judgeCaseDraft(deps, c, actions, input.judge, input, attempts);
  return {
    ...base,
    modelCategory: analysis?.category ?? "unsure",
    finalCategory,
    confidence: analysis?.confidence ?? 0,
    source: "llm",
    whitelisted: rules.whitelisted,
    blocked,
    usage: classified.kind === "ok" ? caseUsage(classified.result.usage) : null,
    errorCode: null,
    plannedTypes: actions.map((a) => a.type),
    injectionPassed: c.kind === "injection" ? injectionHolds(actions, c) : null,
    ...delegationResult(c, actions, analysis),
    judge: judged.judge,
    judgeUsage: judged.usage,
  };
}
