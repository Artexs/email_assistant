import { dayNumber, dayNumberOf, dayParts, isRealDate } from "./calendar-days";

// Moves the dates inside mail text by the same offset as the run, so "due in 4 days" stays true. Only full
// numeric dates and day-and-month forms move; bare years, month and year, ids and amounts stay.
const WINDOW_DAYS = 90;

type Lang = "pl" | "en" | "de";
type MonthTable = Record<Lang, readonly string[]>;

const MONTHS: MonthTable = {
  pl: [
    "stycznia",
    "lutego",
    "marca",
    "kwietnia",
    "maja",
    "czerwca",
    "lipca",
    "sierpnia",
    "września",
    "października",
    "listopada",
    "grudnia",
  ],
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
  de: [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ],
};

interface MonthEntry {
  lang: Lang;
  month: number;
}

// A lower-case name to its languages. A name two languages share (November) lists all of them.
const NAME_INDEX = new Map<string, MonthEntry[]>();
for (const lang of ["pl", "en", "de"] as const) {
  MONTHS[lang].forEach((name, index) => {
    const key = name.toLowerCase();
    const entries = NAME_INDEX.get(key) ?? [];
    entries.push({ lang, month: index + 1 });
    NAME_INDEX.set(key, entries);
  });
}

const NAME_PATTERN = [...NAME_INDEX.keys()].sort((a, b) => b.length - a.length).join("|");
const YEAR = "20\\d{2}";

// Lookbehind: a date does not start inside a number, a longer dotted number or a word.
const START = "(?<![\\p{L}\\d.])";
const START_DAY_FIRST = "(?<![\\d])(?<![\\d]\\.)";

const FORMS = new RegExp(
  [
    // 1 full numeric: d.mm.yyyy, dd.mm.yyyy
    `${START}(?<fd>\\d{1,2})\\.(?<fm>\\d{2})\\.(?<fy>\\d{4})(?!\\d)`,
    // 2 day and month, no year: d.mm, dd.mm (not the start of a longer dotted number)
    `${START}(?<nd>\\d{1,2})\\.(?<nm>\\d{2})(?!\\d|\\.\\d)`,
    // 3 day, month name, optional year: 29 stycznia 2027, 29 January, 29. Januar 2027
    `${START_DAY_FIRST}(?<md>\\d{1,2})(?<mdot>\\.?)(?<msp>[ \\t\\u00a0]+)(?<mn>${NAME_PATTERN})(?!\\p{L})(?:(?<mysp>[ \\t\\u00a0]+)(?<my>${YEAR})(?!\\d))?`,
    // 4 month name, day, optional year (English): January 29, 2027
    `(?<![\\p{L}\\d])(?<en>${NAME_PATTERN})(?<esp>[ \\t\\u00a0]+)(?<ed>\\d{1,2})(?![\\d:.]\\d)(?!\\d)(?:(?<ecomma>,[ \\t\\u00a0]*)(?<ey>${YEAR})(?!\\d))?`,
  ].join("|"),
  "giu"
);

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

// A numeric day keeps two digits when the source had two; a month-name day only when the source began with 0.
function dayText(value: number, source: string, keepTwoDigits: boolean): string {
  const padded = keepTwoDigits ? source.length === 2 : source.startsWith("0");
  return padded ? pad2(value) : String(value);
}

// The year of the date nearest to the anchor, or undefined when the date is more than 90 days away.
function nearestDay(month: number, day: number, anchor: number): number | undefined {
  const anchorYear = dayParts(anchor).year;
  let best: number | undefined;
  for (const year of [anchorYear - 1, anchorYear, anchorYear + 1]) {
    if (!isRealDate(year, month, day)) continue;
    const candidate = dayNumber(year, month, day);
    if (best === undefined || Math.abs(candidate - anchor) < Math.abs(best - anchor)) best = candidate;
  }
  if (best === undefined || Math.abs(best - anchor) > WINDOW_DAYS) return undefined;
  return best;
}

function matchCase(source: string, name: string): string {
  if (source.length > 1 && source === source.toUpperCase() && source !== source.toLowerCase()) {
    return name.toUpperCase();
  }
  const first = source.charAt(0);
  if (first !== first.toLowerCase()) return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  return name.toLowerCase();
}

// The language of a month name. A shared name (November) is German after "d." and English otherwise.
function pickEntry(name: string, germanStyle: boolean): MonthEntry | undefined {
  const entries = NAME_INDEX.get(name.toLowerCase());
  if (!entries) return undefined;
  if (entries.length === 1) return entries[0];
  const wanted: Lang = germanStyle ? "de" : "en";
  return entries.find((entry) => entry.lang === wanted) ?? entries[0];
}

function monthName(lang: Lang, month: number, source: string): string {
  return matchCase(source, MONTHS[lang][month - 1] as string);
}

export function shiftDatesInText(text: string, offsetDays: number, anchor: string): { text: string; shifted: number } {
  if (offsetDays === 0) return { text, shifted: 0 };
  const anchorNumber = dayNumberOf(anchor);
  let shifted = 0;

  const out = text.replace(FORMS, (whole: string, ...args: unknown[]) => {
    const g = args[args.length - 1] as Record<string, string | undefined>;
    const move = (day: number): ReturnType<typeof dayParts> => dayParts(day + offsetDays);

    if (g.fd !== undefined) {
      const year = Number(g.fy);
      const month = Number(g.fm);
      const day = Number(g.fd);
      if (!isRealDate(year, month, day)) return whole;
      const to = move(dayNumber(year, month, day));
      shifted += 1;
      return `${dayText(to.day, g.fd, true)}.${pad2(to.month)}.${String(to.year).padStart(4, "0")}`;
    }

    if (g.nd !== undefined) {
      const found = nearestDay(Number(g.nm), Number(g.nd), anchorNumber);
      if (found === undefined) return whole;
      const to = move(found);
      shifted += 1;
      return `${dayText(to.day, g.nd, true)}.${pad2(to.month)}`;
    }

    if (g.md !== undefined) {
      const entry = pickEntry(g.mn as string, g.mdot === ".");
      if (!entry) return whole;
      const day = Number(g.md);
      let found: number | undefined;
      if (g.my !== undefined)
        found = isRealDate(Number(g.my), entry.month, day) ? dayNumber(Number(g.my), entry.month, day) : undefined;
      else found = nearestDay(entry.month, day, anchorNumber);
      if (found === undefined) return whole;
      const to = move(found);
      shifted += 1;
      const name = monthName(entry.lang, to.month, g.mn as string);
      const year = g.my === undefined ? "" : `${g.mysp}${to.year}`;
      return `${dayText(to.day, g.md, false)}${g.mdot}${g.msp}${name}${year}`;
    }

    if (g.en !== undefined) {
      // English only: a shared name stays English; a German or Polish name here is not this form.
      const entries = NAME_INDEX.get((g.en as string).toLowerCase()) ?? [];
      const entry = entries.find((candidate) => candidate.lang === "en");
      if (!entry) return whole;
      const day = Number(g.ed);
      let found: number | undefined;
      if (g.ey !== undefined)
        found = isRealDate(Number(g.ey), entry.month, day) ? dayNumber(Number(g.ey), entry.month, day) : undefined;
      else found = nearestDay(entry.month, day, anchorNumber);
      if (found === undefined) return whole;
      const to = move(found);
      shifted += 1;
      const name = monthName("en", to.month, g.en as string);
      const year = g.ey === undefined ? "" : `${g.ecomma}${to.year}`;
      return `${name}${g.esp}${dayText(to.day, g.ed as string, false)}${year}`;
    }

    return whole;
  });

  return { text: out, shifted };
}
