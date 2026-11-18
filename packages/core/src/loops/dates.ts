import { z } from "zod";

import { localDateTime, localToInstant, nextLocalDate } from "../digest/local-time";
import { addWorkingDays } from "../metrics/week";
import { DAY_MS } from "../time";

// Pure date rules of the open loops. The model gives a date or a time word; the code resolves it.
// Every due date is 17:00 local time of the organization.
const DUE_TIME = "17:00";
const MAX_DAYS_AHEAD = 60;

// 0 = Sunday … 6 = Saturday, as `localDateTime` returns it.
const weekdayWords = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export const dueWords = [
  "today",
  "tomorrow",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "end_of_week",
  "next_week",
] as const;
export type DueWord = (typeof dueWords)[number];

export const dueRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("date"), date: z.iso.date() }).strict(),
  z.object({ kind: z.literal("word"), word: z.enum(dueWords) }).strict(),
]);
export type DueRef = z.infer<typeof dueRefSchema>;

export interface DueContext {
  sentAt: Date;
  timeZone: string;
}

function addLocalDays(date: string, days: number): string {
  let out = date;
  for (let i = 0; i < days; i++) out = nextLocalDate(out);
  return out;
}

function dayNumber(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / DAY_MS;
}

// Days from `weekday` to the next day with `target`, never the same day: 1 to 7.
function daysToNext(weekday: number, target: number): number {
  return ((target - weekday + 6) % 7) + 1;
}

function resolveDay(word: DueWord, local: { date: string; time: string; weekday: number }): string {
  switch (word) {
    case "today":
      return local.date;
    case "tomorrow":
      return addLocalDays(local.date, 1);
    case "next_week":
      return addLocalDays(local.date, daysToNext(local.weekday, 1));
    case "end_of_week": {
      // Friday of this week; the next Friday when sent on Friday at 17:00 or later, or on a weekend.
      const friday = 5;
      if (local.weekday === friday) {
        return addLocalDays(local.date, local.time < DUE_TIME ? 0 : 7);
      }
      return addLocalDays(local.date, (friday - local.weekday + 7) % 7);
    }
    default:
      return addLocalDays(local.date, daysToNext(local.weekday, weekdayWords.indexOf(word)));
  }
}

// The instant of the due date, or null when it is before `sentAt` or more than 60 local days after it.
export function resolveDue(ref: DueRef, context: DueContext): Date | null {
  const { sentAt, timeZone } = context;
  const local = localDateTime(sentAt, timeZone);
  const day = ref.kind === "date" ? ref.date : resolveDay(ref.word, local);
  const due = localToInstant(day, DUE_TIME, timeZone);
  // A date that does not exist (2026-02-30) moves to another local day: refuse it.
  if (localDateTime(due, timeZone).date !== day) return null;
  if (due.getTime() < sentAt.getTime()) return null;
  if (dayNumber(day) - dayNumber(local.date) > MAX_DAYS_AHEAD) return null;
  return due;
}

// The wait of a loop with no stated due date: `waitDays` working days after the sent mail, at 17:00 local time.
export function defaultDue(sentAt: Date, waitDays: number, timeZone: string): Date {
  const { date } = localDateTime(addWorkingDays(sentAt, waitDays, timeZone), timeZone);
  return localToInstant(date, DUE_TIME, timeZone);
}
