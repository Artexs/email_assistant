import { DAY_MS, shiftDatesInText, type CaseText } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { corpusDir, readScenario, readTexts } from "../platform/sim-files";

// The frozen lab-01 week is only read. The regexes here are the test's own, written apart from the function's.
const OFFSET = -364;
const NAMES = {
  pl: "stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia",
  en: "January|February|March|April|May|June|July|August|September|October|November|December",
  de: "Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember",
};
const MONTH_INDEX = new Map<string, number>();
for (const list of Object.values(NAMES)) {
  list.split("|").forEach((name, index) => MONTH_INDEX.set(name.toLowerCase(), index + 1));
}
const ALL_NAMES = Object.values(NAMES).join("|");

const FULL = /(?<![\p{L}\d.])(\d{1,2})\.(\d{2})\.(\d{4})(?!\d)/gu;
const DAY_MONTH = /(?<![\p{L}\d.])(\d{1,2})\.(\d{2})(?!\d|\.\d)/gu;
const DAY_NAME = new RegExp(
  `(?<!\\d)(\\d{1,2})\\.?[ \\t\\u00a0]+(${ALL_NAMES})(?!\\p{L})(?:[ \\t\\u00a0]+(20\\d{2})(?!\\d))?`,
  "giu"
);
const NAME_DAY = new RegExp(
  `(?<![\\p{L}\\d])(${NAMES.en})[ \\t\\u00a0]+(\\d{1,2})(?![\\d:.]\\d)(?!\\d)(?:,[ \\t\\u00a0]*(20\\d{2})(?!\\d))?`,
  "giu"
);

interface Match {
  text: string;
  month: number;
  day: number;
  year: number | undefined;
  english: boolean;
}

function valid(year: number, month: number, day: number): boolean {
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
}

function matchesOf(regex: RegExp, text: string, pick: (m: RegExpMatchArray) => Omit<Match, "text">): Match[] {
  return [...text.matchAll(regex)].map((m) => ({ text: m[0], ...pick(m) }));
}

const forms = {
  full: (text: string) =>
    matchesOf(FULL, text, (m) => ({ day: Number(m[1]), month: Number(m[2]), year: Number(m[3]), english: false })),
  dayMonth: (text: string) =>
    matchesOf(DAY_MONTH, text, (m) => ({ day: Number(m[1]), month: Number(m[2]), year: undefined, english: false })),
  name: (text: string) => [
    ...matchesOf(DAY_NAME, text, (m) => ({
      day: Number(m[1]),
      month: MONTH_INDEX.get((m[2] as string).toLowerCase()) as number,
      year: m[3] === undefined ? undefined : Number(m[3]),
      english: false,
    })),
    ...matchesOf(NAME_DAY, text, (m) => ({
      day: Number(m[2]),
      month: MONTH_INDEX.get((m[1] as string).toLowerCase()) as number,
      year: m[3] === undefined ? undefined : Number(m[3]),
      english: true,
    })),
  ],
};

const anchorParts = (anchor: string): number => Date.parse(`${anchor}T00:00:00Z`) / DAY_MS;

// The test's own rule: a full date or a dated form with a year always moves; a form without a year moves when
// its date nearest to the anchor lies within ±90 days.
function moves(match: Match, anchor: string): boolean {
  if (match.year !== undefined) return valid(match.year, match.month, match.day);
  const anchorYear = Number(anchor.slice(0, 4));
  const gaps = [anchorYear - 1, anchorYear, anchorYear + 1]
    .filter((year) => valid(year, match.month, match.day))
    .map((year) => Math.abs(Date.UTC(year, match.month - 1, match.day) / DAY_MS - anchorParts(anchor)));
  return gaps.length > 0 && Math.min(...gaps) <= 90;
}

function fieldsOf(text: CaseText): string[] {
  return [text.subject, text.body, text.html ?? "", ...text.thread.flatMap((item) => [item.subject, item.body])];
}

function mask(text: string): string {
  return [FULL, DAY_MONTH, DAY_NAME, NAME_DAY].reduce((acc, regex) => acc.replace(regex, "§"), text);
}

const dir = corpusDir("lab-01");
const anchor = readScenario(dir).calendar.weekStart;
const fields = [...readTexts(dir, "week").values()].flatMap(fieldsOf);

describe("lab-01 week: shiftDatesInText over every text field at offset −364", () => {
  test("anchor is the frozen weekStart and the corpus holds 855 texts", () => {
    expect(anchor).toBe("2027-01-25");
    expect(readTexts(dir, "week").size).toBe(855);
  });

  test("full dates: all 537 valid forms move, 528 inside ±90 days and 9 outside", () => {
    const all = fields.flatMap(forms.full).filter((m) => valid(m.year as number, m.month, m.day));
    const near = all.filter((m) => {
      const gap = Math.abs(Date.UTC(m.year as number, m.month - 1, m.day) / DAY_MS - anchorParts(anchor));
      return gap <= 90;
    });
    expect(all).toHaveLength(537);
    expect(near).toHaveLength(528);
    const result = shiftDatesInText(all.map((m) => m.text).join("\n"), OFFSET, anchor);
    expect(result.shifted).toBe(537);
  });

  test("day and month with no year: only the forms within ±90 days move", () => {
    // A form with month 13+ or a day no month has (a price, a time) is no date.
    const all = fields.flatMap(forms.dayMonth).filter((m) => valid(2024, m.month, m.day));
    const moving = all.filter((m) => moves(m, anchor));
    // 94 date-like forms in subject, body and html; 6 lie outside ±90 days of the anchor and stay.
    expect(all).toHaveLength(94);
    expect(moving).toHaveLength(88);
    const result = shiftDatesInText(all.map((m) => m.text).join("\n"), OFFSET, anchor);
    expect(result.shifted).toBe(moving.length);
  });

  test("month-name forms: with a year all move, without a year those within ±90 days", () => {
    const all = fields.flatMap(forms.name);
    const moving = all.filter((m) => moves(m, anchor));
    expect(all).toHaveLength(46);
    expect(moving).toHaveLength(45);
    const result = shiftDatesInText(all.map((m) => m.text).join("\n"), OFFSET, anchor);
    expect(result.shifted).toBe(moving.length);
  });

  test("on whole fields the function shifts exactly the forms the test counts", () => {
    const expected = fields.reduce((sum, field) => {
      const found = [...forms.full(field), ...forms.dayMonth(field), ...forms.name(field)];
      return sum + found.filter((m) => moves(m, anchor)).length;
    }, 0);
    const shifted = fields.reduce((sum, field) => sum + shiftDatesInText(field, OFFSET, anchor).shifted, 0);
    expect(shifted).toBe(expected);
  });

  test("outside the date forms no character changes", () => {
    let changed = 0;
    for (const field of fields) {
      const result = shiftDatesInText(field, OFFSET, anchor);
      expect(mask(result.text)).toBe(mask(field));
      if (result.text !== field) changed += 1;
    }
    expect(changed).toBeGreaterThan(0);
  });
});
