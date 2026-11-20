// The one format of a legal version: the terms version (`terms.ts`) and the Telegram consent version (`telegram.ts`).
// A version is the UTC date of the change, `YYYY-MM-DD`; a second change on the same day adds `.2`, a third `.3`, and so on.
// The bare date is counter 1. The old terms history holds the spelling `YYYY-MM-DD-N`; it is read as the same version as
// `YYYY-MM-DD.N`, and only the dot spelling is written. No stored string changes.
// Pure: no clock (the caller passes today), no Node import (the browser imports this file through `@ea/core/web`).

export interface LegalVersion {
  date: string;
  // 1 is the bare date.
  counter: number;
}

// A real calendar date, then no counter, or a counter of 2 or more without a leading zero, after a dot or a hyphen.
const LEGAL_VERSION = /^(\d{4}-\d{2}-\d{2})(?:[.-]([2-9]|[1-9]\d+))?$/;

// Build the UTC date and compare it back with the text: `2026-02-30` rolls over to March and fails.
function isCalendarDate(date: string): boolean {
  const built = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(built.getTime()) && built.toISOString().slice(0, 10) === date;
}

// null for anything that is not a version: garbage, a wrong date, a counter of 0 or 1, a leading zero, white space.
export function parseLegalVersion(text: string | null): LegalVersion | null {
  if (text === null) return null;
  const match = LEGAL_VERSION.exec(text);
  const date = match?.[1];
  if (date === undefined || !isCalendarDate(date)) return null;
  const counter = match?.[2] === undefined ? 1 : Number(match[2]);
  if (!Number.isSafeInteger(counter)) return null;
  return { date, counter };
}

// The canonical spelling: the bare date, or `YYYY-MM-DD.N`.
export function formatLegalVersion(version: LegalVersion): string {
  return version.counter === 1 ? version.date : `${version.date}.${version.counter}`;
}

// True when the text parses and is already its canonical spelling (the hyphen spelling is not).
export function isCanonicalLegalVersion(text: string): boolean {
  const version = parseLegalVersion(text);
  return version !== null && formatLegalVersion(version) === text;
}

// Negative when `a` is older than `b`, 0 when they are the same version, positive when `a` is newer.
// The date compares as text (it has a fixed width), the counter as a number: `.10` is after `.9`.
export function compareLegalVersions(a: LegalVersion, b: LegalVersion): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.counter - b.counter;
}

// True when `have` is not older than `since`. A missing or invalid version on either side is not covered (fail closed).
export function legalVersionCovers(have: string | null, since: string): boolean {
  const haveVersion = parseLegalVersion(have);
  const sinceVersion = parseLegalVersion(since);
  if (haveVersion === null || sinceVersion === null) return false;
  return compareLegalVersions(haveVersion, sinceVersion) >= 0;
}

// The version for a change made on `todayUtc` (a bare `YYYY-MM-DD` date): today when it is after the date of `current`,
// otherwise the date of `current` with the counter plus one. It never goes back, also when the clock is behind the last version.
// Throws when `current` is not a version or `todayUtc` is not a bare date.
export function nextLegalVersion(current: string, todayUtc: string): string {
  const last = parseLegalVersion(current);
  if (last === null) throw new Error(`nextLegalVersion: "${current}" is not a legal version`);
  const today = parseLegalVersion(todayUtc);
  if (today === null || today.counter !== 1) throw new Error(`nextLegalVersion: "${todayUtc}" is not a bare UTC date`);
  if (today.date > last.date) return formatLegalVersion(today);
  return formatLegalVersion({ date: last.date, counter: last.counter + 1 });
}
