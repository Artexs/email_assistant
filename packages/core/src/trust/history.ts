// The history check outcome. Only `fail` blocks a category.
import { wilsonInterval } from "../triage/metrics";

export type HistoryOutcome = "pass" | "fail" | "inconclusive" | "no_result";

/** Fewest acted-on mails for a verdict. */
export const HISTORY_MIN_ACTED = 50;
/** `pass`: the Wilson 95% upper bound of the moved share is at or under this. */
export const HISTORY_PASS_UPPER = 0.02;
/** `fail`: the observed moved share is over this. */
export const HISTORY_FAIL_SHARE = 0.02;

export function historyOutcome(input: { acted: number; moved: number }): {
  outcome: HistoryOutcome;
  upper: number | null;
} {
  const { acted, moved } = input;
  if (acted < HISTORY_MIN_ACTED) return { outcome: "no_result", upper: null };
  const { upper } = wilsonInterval(moved, acted);
  if (upper <= HISTORY_PASS_UPPER) return { outcome: "pass", upper };
  if (moved / acted > HISTORY_FAIL_SHARE) return { outcome: "fail", upper };
  return { outcome: "inconclusive", upper };
}
