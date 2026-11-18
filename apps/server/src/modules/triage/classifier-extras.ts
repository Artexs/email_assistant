import { addDays } from "@ea/core";

// A deadline counts as context from the day before today to 30 days after it.
export const DEADLINE_DAYS_BEFORE = 1;
export const DEADLINE_DAYS_AFTER = 30;

// The deadlines due within today−1 … today+30 (both ends included). Dates are YYYY-MM-DD, so text order is date order.
// Shared by the eval mapping (stage 08) and the real-mail reader (stage 10).
export function deadlinesInWindow<T extends { due: string }>(today: string, deadlines: readonly T[]): T[] {
  const from = addDays(today, -DEADLINE_DAYS_BEFORE);
  const to = addDays(today, DEADLINE_DAYS_AFTER);
  return deadlines.filter((deadline) => deadline.due >= from && deadline.due <= to);
}
