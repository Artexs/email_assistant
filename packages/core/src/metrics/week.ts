// The week and the working day of the measures. Pure: every function takes the time zone, none reads the clock.
import { localDateTime, localToInstant, nextLocalDate } from "../digest/local-time";

const DAY_MS = 24 * 3_600_000;

function dateMs(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

function weekdayOf(date: string): number {
  return new Date(dateMs(date)).getUTCDay();
}

function addDays(date: string, days: number): string {
  return new Date(dateMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday (YYYY-MM-DD, local) of the week that holds `at` in `timeZone`. */
export function weekStartOf(at: Date, timeZone: string): string {
  const { date, weekday } = localDateTime(at, timeZone);
  return addDays(date, -((weekday + 6) % 7));
}

/** [start, end): Monday 00:00 local to the next Monday 00:00 local. A DST week has 167 or 169 hours. */
export function weekRange(weekStart: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: localToInstant(weekStart, "00:00", timeZone),
    end: localToInstant(addDays(weekStart, 7), "00:00", timeZone),
  };
}

/** The Monday 7 days before `weekStart`. */
export function previousWeekStart(weekStart: string): string {
  return addDays(weekStart, -7);
}

/** The last finished week at `now`. */
export function lastFinishedWeek(now: Date, timeZone: string): string {
  return previousWeekStart(weekStartOf(now, timeZone));
}

/** `at` plus `days` local weekdays (Mon–Fri, no holidays), same local clock time. A weekend start moves from Monday. */
export function addWorkingDays(at: Date, days: number, timeZone: string): Date {
  const { date: startDate, time } = localDateTime(at, timeZone);
  let date = startDate;
  let counted = 0;
  while (counted < days) {
    date = nextLocalDate(date);
    const weekday = weekdayOf(date);
    if (weekday !== 0 && weekday !== 6) counted += 1;
  }
  return date === startDate ? at : localToInstant(date, time, timeZone);
}
