// The day of the LLM call cap. The free-tier daily quota resets at midnight Pacific time [not verified].
// A change of the quota day is a code change.
export const QUOTA_TIMEZONE = "America/Los_Angeles";

const HOUR_MS = 3_600_000;

interface LocalParts {
  year: number;
  month: number;
  day: number;
}

function localParts(at: Date, timeZone: string): LocalParts & { offsetMs: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
  // `at` has whole seconds in the zone clock: cut the milliseconds before the difference.
  const offsetMs = asUtc - Math.floor(at.getTime() / 1000) * 1000;
  return { year: read("year"), month: read("month"), day: read("day"), offsetMs };
}

// The instant of the last local midnight at or before `now`.
export function quotaDayStart(now: Date, timeZone: string): Date {
  const { year, month, day, offsetMs } = localParts(now, timeZone);
  const midnightUtc = Date.UTC(year, month - 1, day);
  let candidate = midnightUtc - offsetMs;
  // Read the offset again at the candidate: it differs on a daylight-saving change day.
  const corrected = localParts(new Date(candidate), timeZone).offsetMs;
  if (corrected !== offsetMs) candidate = midnightUtc - corrected;
  return new Date(candidate);
}

export function nextQuotaDayStart(now: Date, timeZone: string): Date {
  return quotaDayStart(new Date(quotaDayStart(now, timeZone).getTime() + 26 * HOUR_MS), timeZone);
}
