// Pure rules for "which digest is due now" (P1, D15). Slot keys are local wall-clock strings
// `YYYY-MM-DDTHH:MM`, so a daylight-saving change gives no double and no lost digest.
import { localDateTime, localKey, localToInstant, nextLocalDate } from "./local-time";

export const DIGEST_LATE_MS = 6 * 3_600_000;
export const MAX_DIGEST_TIMES = 6;

const LATE_SLOT_MS = 10 * 60_000;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface DigestSlot {
  key: string;
  date: string;
  time: string;
}

function sortedUnique(times: readonly string[]): string[] {
  return [...new Set(times)].sort();
}

// DB values ("08:00:00") or "HH:MM" → sorted, unique "HH:MM". A value that is not a valid time is dropped.
export function parseDigestTimes(raw: readonly string[]): string[] {
  const times = raw.map((value) => value.slice(0, 5)).filter((value) => TIME_PATTERN.test(value));
  return sortedUnique(times);
}

export function parseDigestTimesInput(input: string): { ok: true; times: string[] } | { ok: false; error: string } {
  const text = input.trim();
  if (text.toLowerCase() === "none") return { ok: true, times: [] };
  if (text === "") return { ok: false, error: "empty input" };
  const parts = text.split(",").map((part) => part.trim());
  for (const part of parts) {
    if (!TIME_PATTERN.test(part)) return { ok: false, error: `bad time: ${part}` };
  }
  const times = sortedUnique(parts);
  if (times.length > MAX_DIGEST_TIMES) return { ok: false, error: `too many times (max ${MAX_DIGEST_TIMES})` };
  return { ok: true, times };
}

// The newest slot that is due: not older than 6 hours, not after `now`, and after `afterKey`.
// Earlier missed slots are skipped (one digest per run).
export function dueDigestSlot(input: {
  now: Date;
  timeZone: string;
  times: readonly string[];
  afterKey: string | null;
}): DigestSlot | null {
  const { now, timeZone, times, afterKey } = input;
  const nowKey = localKey(now, timeZone);
  const earliest = new Date(now.getTime() - DIGEST_LATE_MS);
  const lateKey = localKey(earliest, timeZone);
  const dates = [...new Set([localDateTime(earliest, timeZone).date, localDateTime(now, timeZone).date])];
  const keys = dates.flatMap((date) => times.map((time) => `${date}T${time}`));
  const kept = keys.filter((key) => key > lateKey && key <= nowKey && (afterKey === null || key > afterKey));
  const key = kept.sort().at(-1);
  if (key === undefined) return null;
  return { key, date: key.slice(0, 10), time: key.slice(11) };
}

// The next digest time after `now`: today or the next local date.
export function nextDigestTime(input: {
  now: Date;
  timeZone: string;
  times: readonly string[];
}): { date: string; time: string } | null {
  const { now, timeZone, times } = input;
  const today = localDateTime(now, timeZone);
  const nowKey = `${today.date}T${today.time}`;
  const keys = [today.date, nextLocalDate(today.date)].flatMap((date) => times.map((time) => `${date}T${time}`));
  const key = keys.filter((candidate) => candidate > nowKey).sort()[0];
  if (key === undefined) return null;
  return { date: key.slice(0, 10), time: key.slice(11) };
}

export function isLateSlot(slot: DigestSlot, now: Date, timeZone: string): boolean {
  return now.getTime() - localToInstant(slot.date, slot.time, timeZone).getTime() > LATE_SLOT_MS;
}
