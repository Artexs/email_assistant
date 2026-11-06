// Time zone helpers for the digest schedule, the quiet hours and the "HH:MM" texts. Pure: no I/O.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface LocalDateTime {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM, 24 h
  weekday: number; // 0 = Sunday … 6 = Saturday
}

export interface QuietHours {
  start: string;
  end: string;
}

// P4: no notices from 22:00 to 07:00 in the organization time zone. A change is a code change.
export const QUIET_HOURS: QuietHours = { start: "22:00", end: "07:00" };

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

// The instant of a local date and time. An ambiguous time (autumn change) gives the later instant.
// A time in the spring gap gives the instant one hour later on the wall clock (02:30 → 03:30).
export function localToInstant(date: string, time: string, timeZone: string): Date {
  const naive = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Number(time.slice(0, 2)),
    Number(time.slice(3, 5))
  );
  const naiveOffset = offsetMs(naive, timeZone);
  const first = naive - naiveOffset;
  const firstOffset = offsetMs(first, timeZone);
  return new Date(firstOffset === naiveOffset ? first : naive - firstOffset);
}

export function formatClock(at: Date, timeZone: string, now: Date): string {
  const local = localParts(at, timeZone);
  const today = localParts(now, timeZone);
  const clock = `${pad(local.hour)}:${pad(local.minute)}`;
  if (dateText(local.year, local.month, local.day) === dateText(today.year, today.month, today.day)) return clock;
  const dayMonth = `${local.day} ${MONTHS[local.month - 1]}`;
  return local.year === today.year ? `${dayMonth} ${clock}` : `${dayMonth} ${local.year} ${clock}`;
}

export function formatDay(at: Date, timeZone: string): string {
  const local = localParts(at, timeZone);
  return `${WEEKDAYS[local.weekday]} ${local.day} ${MONTHS[local.month - 1]}`;
}

export function isQuietTime(at: Date, timeZone: string, quiet: QuietHours = QUIET_HOURS): boolean {
  const { time } = localDateTime(at, timeZone);
  if (quiet.start === quiet.end) return false;
  if (quiet.start < quiet.end) return time >= quiet.start && time < quiet.end;
  return time >= quiet.start || time < quiet.end;
}

// The instant when the quiet hours end. Outside the quiet hours it returns `at`.
export function quietEnd(at: Date, timeZone: string, quiet: QuietHours = QUIET_HOURS): Date {
  if (!isQuietTime(at, timeZone, quiet)) return at;
  const { date, time } = localDateTime(at, timeZone);
  if (quiet.start > quiet.end && time >= quiet.start) {
    return localToInstant(nextLocalDate(date), quiet.end, timeZone);
  }
  return localToInstant(date, quiet.end, timeZone);
}
