const DAY_MS = 86_400_000;
// A deadline counts as context from the day before today to 30 days after it.
export const DEADLINE_DAYS_BEFORE = 1;
export const DEADLINE_DAYS_AFTER = 30;

function shiftDate(date: string, days: number): string {
  const at = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return new Date(at + days * DAY_MS).toISOString().slice(0, 10);
}

// The deadlines due within today−1 … today+30 (both ends included). Dates are YYYY-MM-DD, so text order is date order.
// Shared by the eval mapping (stage 08) and the real-mail reader (stage 10).
export function deadlinesInWindow<T extends { due: string }>(today: string, deadlines: readonly T[]): T[] {
  const from = shiftDate(today, -DEADLINE_DAYS_BEFORE);
  const to = shiftDate(today, DEADLINE_DAYS_AFTER);
  return deadlines.filter((deadline) => deadline.due >= from && deadline.due <= to);
}
