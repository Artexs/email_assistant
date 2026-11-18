// Calendar-day arithmetic on YYYY-MM-DD strings. Pure: it works on UTC day numbers and never on local time.
import { addDays as shiftDay, DAY_MS } from "../../time";

export function parseDay(date: string): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return isRealDate(year, month, day) ? { year, month, day } : undefined;
}

export function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
}

// Whole days since 1970-01-01 of a date that `isRealDate` accepted.
export function dayNumber(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function dayParts(number: number): { year: number; month: number; day: number } {
  const at = new Date(number * DAY_MS);
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
}

export function formatDay(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// The day number of a YYYY-MM-DD string; throws on a text that is not a real date.
export function dayNumberOf(date: string): number {
  const parts = parseDay(date);
  if (!parts) throw new Error(`not a date: ${date}`);
  return dayNumber(parts.year, parts.month, parts.day);
}

// The same shift as `addDays` of `../../time`, but a text that is not a real date throws.
export function addDays(date: string, days: number): string {
  dayNumberOf(date);
  return shiftDay(date, days);
}

// Monday = 1 … Sunday = 7.
export function isoWeekday(date: string): number {
  const weekday = new Date(dayNumberOf(date) * DAY_MS).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}
