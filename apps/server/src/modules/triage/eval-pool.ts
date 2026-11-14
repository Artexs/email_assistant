import type { CaseUsage } from "./eval";

// A run with a budget: the cap is the run cap after the month rule (the CLI computes it).
export interface EvalBudget {
  capUsd: number;
  // Null: the price of the model is unknown. Such a call counts as zero spend.
  callCostUsd(usage: CaseUsage, at: Date): number | null;
  // The price of 2,000 tokens in and 300 tokens out for the run's model: the average before the first result.
  firstEstimateUsd: number;
}

export const BUDGET_STOP_REASON = "budget cap reached: resume after the cap allows it";

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

function spendOf(budget: EvalBudget | undefined, result: PoolResult, at: Date): number | null {
  if (budget === undefined || result.usage === null) return null;
  return budget.callCostUsd(result.usage, at);
}

// A pool of `concurrency` workers takes the next case that has no earlier result, in input order.
// Before it starts a case, the pool applies the stop rules; a stop is final. Calls in flight finish and count.
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
  run(c: C): Promise<R>;
  onResult?(result: R): Promise<void>;
}): Promise<PoolOutcome<R>> {
  const results = new Map<string, R>();
  let spentUsd = 0;
  for (const result of input.earlier.values()) {
    results.set(result.id, result);
    spentUsd += spendOf(input.budget, result, input.now) ?? 0;
  }

  let next = 0;
  let llmInFlight = 0;
  let errorsInRow = 0;
  let stoppedReason: string | null = null;
  let stoppedByBudget = false;
  let newCostSum = 0;
  let newCostCount = 0;

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
      if (llm && input.budget !== undefined) {
        const average = newCostCount === 0 ? input.budget.firstEstimateUsd : newCostSum / newCostCount;
        if (spentUsd + (llmInFlight + 1) * average > input.budget.capUsd + CAP_EPSILON) {
          stoppedReason = BUDGET_STOP_REASON;
          stoppedByBudget = true;
          return;
        }
      }

      if (llm) llmInFlight += 1;
      let result: R;
      try {
        result = await input.run(c);
      } catch (error) {
        // A config error ends the run: no worker starts another call.
        stoppedReason = stoppedReason ?? input.errorStopReason;
        throw error;
      } finally {
        if (llm) llmInFlight -= 1;
      }

      results.set(result.id, result);
      const cost = spendOf(input.budget, result, input.now);
      if (cost !== null) {
        spentUsd += cost;
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
