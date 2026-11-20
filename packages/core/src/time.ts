// The one place for the time constants and the calendar-day shift. Pure: no clock, no Node module (the web imports it).

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** A YYYY-MM-DD date moved by `days` calendar days (negative moves back), computed on UTC days. */
export function addDays(date: string, days: number): string {
  const at = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return new Date(at + days * DAY_MS).toISOString().slice(0, 10);
}
