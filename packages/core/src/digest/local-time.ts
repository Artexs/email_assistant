// Time zone helpers for the digest schedule, the quiet hours and the "HH:MM" texts. Pure: no I/O.
import type { UserLocale } from "../tenancy";
import { clockTexts } from "../texts/clock";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "../time";

// `localParts` parses the `en-US` short weekday with this list. The display uses `clockTexts`.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface LocalDateTime {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM, 24 h
  weekday: number; // 0 = Sunday … 6 = Saturday
}

export interface QuietHours {
  start: string;
  end: string;
}

// No notices from 22:00 to 07:00 in the organization time zone. A change is a code change.
export const QUIET_HOURS: QuietHours = { start: "22:00", end: "07:00" };

// The quiet hours of a member row: both columns null means the default; equal start and end means none.
export function quietHoursOf(start: string | null, end: string | null): QuietHours {
  return start === null || end === null ? QUIET_HOURS : { start, end };
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

function localParts(at: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(at);
  const text = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const read = (type: string): number => Number(text(type));
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
    weekday: WEEKDAYS.indexOf(text("weekday")),
  };
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function dateText(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function localDateTime(at: Date, timeZone: string): LocalDateTime {
  const parts = localParts(at, timeZone);
  return {
    date: dateText(parts.year, parts.month, parts.day),
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
    weekday: parts.weekday,
  };
}

export function localKey(at: Date, timeZone: string): string {
  const { date, time } = localDateTime(at, timeZone);
  return `${date}T${time}`;
}

// The offset of the zone at instant `t`: the local wall clock read as UTC, minus `t`.
function offsetMs(t: number, timeZone: string): number {
  const parts = localParts(new Date(t), timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

// The local date after `date`, from the date parts (never by adding 24 hours to an instant).
export function nextLocalDate(date: string): string {
  const next = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + 1)
  );
  return dateText(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

interface LocalInstants {
  // The instants at which the wall clock reads the time, oldest first; in a gap the one instant after the change.
  instants: number[];
  // The instant of the change itself when the time falls in a spring gap, else null.
  change: number | null;
}

// The instants at which the wall clock of the zone reads `date` `time`: one on a normal day, two in the autumn hour that
// repeats. In the spring gap the time never shows: the instant is the first one after the change, on the same side of UTC for
// every zone (02:30 → 03:30 in Warsaw and in New York).
function localInstants(date: string, time: string, timeZone: string): LocalInstants {
  const naive = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Number(time.slice(0, 2)),
    Number(time.slice(3, 5))
  );
  // The offsets on both sides of a change near this date. A candidate counts only when the zone has that offset at the candidate.
  const before = offsetMs(naive - DAY_MS, timeZone);
  const after = offsetMs(naive + DAY_MS, timeZone);
  const found = new Set<number>();
  for (const offset of [before, after]) {
    const candidate = naive - offset;
    if (offsetMs(candidate, timeZone) === offset) found.add(candidate);
  }
  if (found.size > 0) return { instants: [...found].sort((a, b) => a - b), change: null };
  // A gap: the smaller offset is the one before the change, so `naive - smaller` is just after it. The change lies between
  // `naive - larger` (still the old offset) and that instant; a search by the minute finds it.
  const [old, current] = before < after ? [before, after] : [after, before];
  let low = naive - current;
  let high = naive - old;
  while (high - low > MINUTE_MS) {
    const mid = low + Math.floor((high - low) / 2 / MINUTE_MS) * MINUTE_MS;
    if (mid <= low) break;
    if (offsetMs(mid, timeZone) === old) low = mid;
    else high = mid;
  }
  return { instants: [naive - old], change: high };
}

// The instant of a local date and time. An ambiguous time (autumn change) gives the later instant.
// A time in the spring gap gives the instant one hour later on the wall clock (02:30 → 03:30).
export function localToInstant(date: string, time: string, timeZone: string): Date {
  const { instants } = localInstants(date, time, timeZone);
  return new Date(instants[instants.length - 1] as number);
}

// The first instant of a local date: the earliest time the wall clock reads 00:00, and when the zone skips midnight (a
// spring change at 00:00, as in Havana or Santiago) the instant of the change itself. `localToInstant` would give the later
// instant, one hour into the day, which moves a "by the end of the day" window by one hour.
export function startOfLocalDay(date: string, timeZone: string): Date {
  const { instants, change } = localInstants(date, "00:00", timeZone);
  return new Date(change ?? (instants[0] as number));
}

export function formatClock(at: Date, timeZone: string, now: Date, locale: UserLocale): string {
  const local = localParts(at, timeZone);
  const today = localParts(now, timeZone);
  const clock = `${pad(local.hour)}:${pad(local.minute)}`;
  if (dateText(local.year, local.month, local.day) === dateText(today.year, today.month, today.day)) return clock;
  const dayMonth = `${local.day} ${clockTexts[locale].months[local.month - 1]}`;
  return local.year === today.year ? `${dayMonth} ${clock}` : `${dayMonth} ${local.year} ${clock}`;
}

export function formatDay(at: Date, timeZone: string, locale: UserLocale): string {
  const local = localParts(at, timeZone);
  const { months, weekdays } = clockTexts[locale];
  return `${weekdays[local.weekday]} ${local.day} ${months[local.month - 1]}`;
}

// "Tue 10.11" or "wt. 10.11": the weekday, the day and the month in numbers (the brief lines).
export function formatDayNumeric(at: Date, timeZone: string, locale: UserLocale): string {
  const local = localParts(at, timeZone);
  return `${clockTexts[locale].weekdays[local.weekday]} ${pad(local.day)}.${pad(local.month)}`;
}

export function isQuietTime(at: Date, timeZone: string, quiet: QuietHours = QUIET_HOURS): boolean {
  const { time } = localDateTime(at, timeZone);
  if (quiet.start === quiet.end) return false;
  if (quiet.start < quiet.end) return time >= quiet.start && time < quiet.end;
  return time >= quiet.start || time < quiet.end;
}

// The instant when the quiet hours end. Outside the quiet hours it returns `at`. The end is the first instant after `at` at
// which the wall clock reads the end time: in the autumn hour that repeats it can be the second one, and an end time in the
// spring gap is the instant of the change (the wall clock jumps over it). The result is always after `at`.
export function quietEnd(at: Date, timeZone: string, quiet: QuietHours = QUIET_HOURS): Date {
  if (!isQuietTime(at, timeZone, quiet)) return at;
  const { date, time } = localDateTime(at, timeZone);
  const endDate = quiet.start > quiet.end && time >= quiet.start ? nextLocalDate(date) : date;
  const { instants, change } = localInstants(endDate, quiet.end, timeZone);
  const next = (change === null ? instants : [change]).find((instant) => instant > at.getTime());
  // No instant is left on that date (a zone that changed its rules twice in 2 days): wait one minute and ask again.
  return new Date(next ?? at.getTime() + MINUTE_MS);
}

// Minutes from `from` to `to` that lie outside the quiet hours of the time zone. The sender holds
// a notice in quiet hours by the time of the send, so the minutes in quiet hours are not late. Zero when `to <= from`.
export function lateMin(from: Date, to: Date, timeZone: string, quiet: QuietHours = QUIET_HOURS): number {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  if (toMs <= fromMs) return 0;
  let quietMs = 0;
  if (quiet.start !== quiet.end) {
    const wraps = quiet.start > quiet.end;
    // One quiet window starts on each local date; the window of the day before `from` can still cover it.
    let date = localDateTime(new Date(fromMs - 36 * HOUR_MS), timeZone).date;
    const lastDate = localDateTime(to, timeZone).date;
    let more = true;
    while (more) {
      const windowStart = localToInstant(date, quiet.start, timeZone).getTime();
      const windowEnd = localToInstant(wraps ? nextLocalDate(date) : date, quiet.end, timeZone).getTime();
      quietMs += Math.max(0, Math.min(toMs, windowEnd) - Math.max(fromMs, windowStart));
      more = date < lastDate;
      if (more) date = nextLocalDate(date);
    }
  }
  return (toMs - fromMs - quietMs) / MINUTE_MS;
}
