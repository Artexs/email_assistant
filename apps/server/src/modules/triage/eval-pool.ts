import { costPerMail } from "@ea/core";

import type { CaseUsage } from "./eval";

// A run with a budget: the cap is the run cap after the month rule (the CLI computes it).
export interface EvalBudget {
  capUsd: number;
  // Null: the price is unknown. Such a call is charged at the estimate, never at zero.
  callCostUsd(usage: CaseUsage, at: Date): number | null;
  // The price of 2,000 tokens in and 300 tokens out for the run's model: the average before the first result.
  // It must be a finite number above zero: a zero estimate would mean "no cap".
  firstEstimateUsd: number;
  // Called for every charge of this run (a result, a failed attempt) with the dollars added to the spend.
  onSpend?(usd: number): void;
}

export const BUDGET_STOP_REASON = "budget cap reached: resume after the cap allows it";

const FIRST_ESTIMATE_TOKENS = { in: 2000, out: 300 };

// The price of the first-call estimate, or null when the model has no price or the price gives no usable estimate.
export function firstEstimateUsd(model: string, at: Date): number | null {
  const usd = costPerMail(model, FIRST_ESTIMATE_TOKENS.in, FIRST_ESTIMATE_TOKENS.out, at);
  return usd !== null && Number.isFinite(usd) && usd > 0 ? usd : null;
}

// What a case tells the pool about its LLM attempts.
export interface AttemptHooks {
  // One attempt ended without a usable answer (an error, a block). The pool charges it.
  failed(): void;
  // False when one more attempt could pass the cap: the case then ends with its last error.
  mayRetry(): boolean;
}

// The part of a case result the pool reads.
interface PoolResult {
  id: string;
  source: "llm" | "rule";
  usage: CaseUsage | null;
  errorCode: string | null;
}

export interface PoolOutcome<R extends PoolResult> {
  // Earlier results and new results by case id. The caller builds its report in input order from it.
  results: Map<string, R>;
  stoppedReason: string | null;
  stoppedByBudget: boolean;
  // Spend of the earlier results plus the new ones.
  spentUsd: number;
}

// Float sums like 0.0012 + 0.0003 must not stop a run that sits exactly on the cap.
const CAP_EPSILON = 1e-12;

// A pool of `concurrency` workers takes the next case that has no earlier result, in input order.
// Before it starts a case, the pool applies the stop rules; a stop is final. Calls in flight finish and count.
// Money rules: a failed attempt (also a retry inside a case) is charged at the larger of the running average and the
// first estimate; a cost that is unknown, NaN or infinite is charged at the same value; a negative cost counts as zero.
export async function runPool<C extends { id: string }, R extends PoolResult>(input: {
  cases: readonly C[];
  earlier: ReadonlyMap<string, R>;
  concurrency: number;
  budget?: EvalBudget;
  stopAfterErrors: number;
  errorStopReason: string;
  now: Date;
  // A case that ends without an LLM call (a rule) never stops the run for budget.
  usesLlm(c: C): boolean;
  run(c: C, attempts: AttemptHooks): Promise<R>;
  onResult?(result: R): Promise<void>;
}): Promise<PoolOutcome<R>> {
  const { budget } = input;
  if (
    budget !== undefined &&
    (!Number.isFinite(budget.firstEstimateUsd) || budget.firstEstimateUsd <= 0 || !Number.isFinite(budget.capUsd))
  ) {
    throw new Error("budget needs a finite cap and a first estimate above zero");
  }

  let newCostSum = 0;
  let newCostCount = 0;
  // The mean cost of the new results, else the first estimate (the start rule).
  const average = (): number =>
    budget === undefined ? 0 : newCostCount === 0 ? budget.firstEstimateUsd : newCostSum / newCostCount;
  // What a call of unknown cost, and a failed attempt, is charged.
  const estimate = (): number => (budget === undefined ? 0 : Math.max(average(), budget.firstEstimateUsd));

  let spentUsd = 0;
  const charge = (usd: number, isNew: boolean): void => {
    spentUsd += usd;
    if (isNew) budget?.onSpend?.(usd);
  };

  const costOf = (result: PoolResult): number => {
    if (budget === undefined) return 0;
    if (result.usage === null) return 0;
    const cost = budget.callCostUsd(result.usage, input.now);
    if (cost === null || !Number.isFinite(cost)) return estimate();
    return Math.max(0, cost);
  };

  const results = new Map<string, R>();
  for (const result of input.earlier.values()) {
    results.set(result.id, result);
    // A blocked answer of an earlier run holds no usage but was a call: charge it at the estimate.
    spentUsd += result.source === "llm" && result.usage === null ? estimate() : costOf(result);
  }

  let next = 0;
  let llmInFlight = 0;
  let errorsInRow = 0;
  let stoppedReason: string | null = null;
  let stoppedByBudget = false;

  const attempts: AttemptHooks = {
    failed: () => {
      if (budget !== undefined) charge(estimate(), true);
    },
    mayRetry: () =>
      budget === undefined || spentUsd + Math.max(1, llmInFlight) * estimate() <= budget.capUsd + CAP_EPSILON,
  };

  async function worker(): Promise<void> {
    while (stoppedReason === null) {
      const c = input.cases[next];
      if (c === undefined) return;
      next += 1;
      if (input.earlier.has(c.id)) continue;

      if (errorsInRow >= input.stopAfterErrors) {
        stoppedReason = input.errorStopReason;
        return;
      }
      const llm = input.usesLlm(c);
      if (llm && budget !== undefined && spentUsd + (llmInFlight + 1) * average() > budget.capUsd + CAP_EPSILON) {
        stoppedReason = BUDGET_STOP_REASON;
        stoppedByBudget = true;
        return;
      }

      if (llm) llmInFlight += 1;
      let result: R;
      try {
        result = await input.run(c, attempts);
      } catch (error) {
        // A config error ends the run: no worker starts another call.
        stoppedReason = stoppedReason ?? input.errorStopReason;
        throw error;
      } finally {
        if (llm) llmInFlight -= 1;
      }

      results.set(result.id, result);
      if (budget !== undefined && result.usage !== null) {
        const cost = costOf(result);
        charge(cost, true);
        newCostSum += cost;
        newCostCount += 1;
      }
      if (result.errorCode !== null) errorsInRow += 1;
      else if (result.source === "llm") errorsInRow = 0;
      await input.onResult?.(result);
    }
  }

  const count = Math.max(1, Math.floor(input.concurrency));
  await Promise.all(Array.from({ length: count }, () => worker()));
  return { results, stoppedReason, stoppedByBudget, spentUsd };
}
