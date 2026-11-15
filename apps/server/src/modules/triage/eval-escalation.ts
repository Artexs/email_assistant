import {
  type Category,
  computeMetrics,
  confusionMatrix,
  costPerMail,
  type EscalationSignals,
  type EvalCase,
  type LlmEndpointKind,
  type Prediction,
} from "@ea/core";

import type { LlmProviderId } from "../../platform/llm";

import type { CaseResult, CaseUsage } from "./eval";

// F109 stage 12: the escalation measure of a sim run (`eval --sim --escalate`). Counts and codes only.

// What a run needs to name the escalation row in the report and the gate file.
export interface EscalationSetup {
  provider: LlmProviderId;
  model: string;
  host: string | null;
  reasoningEffort: string | null;
}

// The first answer of a case that the escalation replaced. The top-level fields of the result hold the cascade answer.
export interface CaseEscalation {
  first: { modelCategory: Category; finalCategory: Category; confidence: number };
}

function headerOf(headers: Readonly<Record<string, string>>, name: string): string | null {
  const wanted = name.toLowerCase();
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === wanted);
  return key === undefined ? null : (headers[key] ?? null);
}

/** The trigger input of a sim case: `noreply` from the sender rules, the list and auto headers from `sim.headers`. */
export function escalationSignalsOfCase(
  c: EvalCase,
  first: { finalCategory: Category; reasonCode: string | null; noreply: boolean }
): EscalationSignals {
  const headers = c.sim?.headers ?? {};
  return {
    finalCategory: first.finalCategory,
    reasonCode: first.reasonCode,
    noreply: first.noreply,
    isList: headerOf(headers, "List-Id") !== null || headerOf(headers, "List-Unsubscribe") !== null,
    autoSubmitted: headerOf(headers, "Auto-Submitted"),
    precedence: headerOf(headers, "Precedence"),
  };
}

const HIDING: readonly Category[] = ["info", "notification", "spam"];
const IMPORTANT: readonly Category[] = ["urgent", "needs_reply", "delegation"];

export interface Misses {
  // `urgent` mail with another final category.
  urgentMissed: number;
  // `needs_reply` mail with a final `info`, `notification`, `spam` or `unsure` (stage 09 definition of `K`).
  needsReplyHidden: number;
  // Mail of another truth with a final `spam`.
  spamFalsePositives: number;
  // `K` = the three counts above.
  k: number;
  // `H`: `urgent`, `needs_reply` or `delegation` mail with a final `info`, `notification` or `spam`.
  h: number;
}

/** The key misses of a set of predictions. Like the confusion matrix, it counts the LLM rows only. */
export function missesOf(predictions: Prediction[]): Misses {
  const matrix = confusionMatrix(predictions);
  const sum = (expected: readonly Category[], predicted: readonly Category[]): number =>
    expected.reduce((total, e) => total + predicted.reduce((inner, p) => inner + matrix[e][p], 0), 0);
  const urgentMissed = (Object.keys(matrix.urgent) as Category[])
    .filter((p) => p !== "urgent")
    .reduce((total, p) => total + matrix.urgent[p], 0);
  const needsReplyHidden = sum(["needs_reply"], [...HIDING, "unsure"]);
  const others = (Object.keys(matrix) as Category[]).filter((e) => e !== "spam");
  const spamFalsePositives = sum(others, ["spam"]);
  return {
    urgentMissed,
    needsReplyHidden,
    spamFalsePositives,
    k: urgentMissed + needsReplyHidden + spamFalsePositives,
    h: sum(IMPORTANT, HIDING),
  };
}

export interface EscalationReport extends EscalationSetup {
  endpoint: LlmEndpointKind;
  promptVersion: string;
  // Cases with a final answer, and the cases among them that got a second call.
  answered: number;
  triggered: number;
  // `from->to` of the final category, for the cases where the second answer changed it.
  changed: Record<string, number>;
  first: { misses: Misses; metrics: ReturnType<typeof computeMetrics> };
  cascade: { misses: Misses; metrics: ReturnType<typeof computeMetrics> };
  // Cases with a first call; the cost per mail divides by it.
  calledCases: number;
  // Null when no call has a price.
  cost: { classifierUsd: number | null; escalationUsd: number | null };
}

function sumUsd(usages: readonly CaseUsage[], endpoint: LlmEndpointKind, at: Date): number | null {
  const costs = usages.map((u) => costPerMail(u.model, u.tokensIn, u.tokensOut, at, endpoint));
  const known = costs.filter((cost): cost is number => cost !== null);
  return known.length === 0 ? null : known.reduce((total, cost) => total + cost, 0);
}

/** The `## Escalation` data of a run. `toPrediction` maps a result to a prediction (null for an error case). */
export function summarizeEscalation(input: {
  cases: readonly CaseResult[];
  setup: EscalationSetup;
  endpoints: { classifier: LlmEndpointKind; escalation: LlmEndpointKind };
  promptVersion: string;
  at: Date;
  toPrediction: (result: CaseResult) => Prediction | null;
}): EscalationReport {
  const { cases, toPrediction } = input;
  const firstOf = (result: CaseResult): CaseResult =>
    result.escalation == null ? result : { ...result, ...result.escalation.first };
  const cascade: Prediction[] = [];
  const first: Prediction[] = [];
  const changed: Record<string, number> = {};
  let answered = 0;
  let triggered = 0;
  for (const result of cases) {
    const final = toPrediction(result);
    if (final === null) continue;
    answered += 1;
    cascade.push(final);
    const firstPrediction = toPrediction(firstOf(result));
    if (firstPrediction !== null) first.push(firstPrediction);
    if (result.escalation == null) continue;
    triggered += 1;
    if (result.escalation.first.finalCategory !== final.predicted) {
      const key = `${result.escalation.first.finalCategory}->${final.predicted}`;
      changed[key] = (changed[key] ?? 0) + 1;
    }
  }
  const usages = (pick: (r: CaseResult) => CaseUsage | null | undefined): CaseUsage[] =>
    cases.map(pick).filter((u): u is CaseUsage => u != null);
  return {
    ...input.setup,
    endpoint: input.endpoints.escalation,
    promptVersion: input.promptVersion,
    answered,
    triggered,
    changed,
    first: { misses: missesOf(first), metrics: computeMetrics(first) },
    cascade: { misses: missesOf(cascade), metrics: computeMetrics(cascade) },
    calledCases: cases.filter((r) => r.usage !== null).length,
    cost: {
      classifierUsd: sumUsd(
        usages((r) => r.usage),
        input.endpoints.classifier,
        input.at
      ),
      escalationUsd: sumUsd(
        usages((r) => r.escalationUsage),
        input.endpoints.escalation,
        input.at
      ),
    },
  };
}
