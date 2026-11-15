// The digit budget of a reply body (owner decision "digit budget", F115 stage 01 re-review 2). A bank account or card
// number can be written with any separator, word, mark, markup or quote prefix between its groups, so no pattern of
// separators can find it. The check counts digits instead. The body is folded (`views.ts`), every maximal run of digits
// is taken, and each run is
//   - KNOWN: its digits (3 or more) are a substring of a number that the user typed (instruction, signature, writing
//     style), or of a number of 9 to 12 digits in the quoted mail (an order number; never a longer run);
//   - FREE: it lies inside a valid date or time, or inside a number of the form of money, a percentage, a rate, a postal
//     code or a year, or inside an amount of at most 9 integer digits next to a currency;
//   - or it costs its digits.
// The draft fails `account_number` when the cost of the whole body is above DIGIT_BUDGET, and `phone` when the digits
// that cost something make a phone-like run of 9 or more digits. A real IBAN (mod 97) fails whatever its digits cost.
// Pure code.
import { plainView, skeleton, viewsOf } from "./views";

/** The digits of a whole body that no typed text, date, time or amount explains. */
export const DIGIT_BUDGET = 12;
/** A run of this many digits that costs something is a phone number. */
export const PHONE_DIGITS = 9;
/** A run shorter than this is never KNOWN: one digit of a typed number would make every digit free. */
export const KNOWN_MIN_DIGITS = 3;
/** The runs of the quoted mail that are KNOWN have 9 to 12 digits. */
export const MAIL_KNOWN_MIN_DIGITS = 9;
export const MAIL_KNOWN_MAX_DIGITS = 12;
/** A cut leaves this text: no run of digits joins across it. */
const SEPARATOR = " ; ";

// ---- What is free ----------------------------------------------------------------------------------------------
// A calendar date, a Polish or English date with the month in words, a time, and a quarter or half-year ("Q3 2025").
const DATE_DMY = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?!\d)/g;
const DATE_YMD = /(?<!\d)(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/g;
const TIME = /(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)/g;
const MONTHS =
  "stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrzesnia|pazdziernika|listopada|grudnia|january|february|march|april|may|june|july|august|september|october|november|december";
const DATE_WORDS = new RegExp(`(\\d{1,2})\\s(?:${MONTHS})\\s(\\d{4})(?!\\d)`, "giu");
const PERIOD = /(?<![\p{L}\d])[QH][1-4]\s(\d{4})(?!\d)/giu;

// A number that is no account: it stands alone (no letter or digit glued to it) and has the form of money (two
// decimals), of a percentage, of a rate (1–2 integer digits and 1–4 decimals), of a postal code, or it is an amount
// next to a currency.
const ALONE_BEFORE = String.raw`(?<![\p{L}\d]|\d[ .,])`;
const ALONE_AFTER = String.raw`(?![\p{L}\d]|[ .,]\d)`;
const GROUPED = String.raw`(?:\d{1,3}(?:[ .,]\d{3})+|\d+)`;
const MONEY = new RegExp(`${ALONE_BEFORE}(${GROUPED})[,.]\\d{2}${ALONE_AFTER}`, "gu");
const PERCENT = new RegExp(
  `${ALONE_BEFORE}\\d{1,3}(?:[,.]\\d{1,2})?(?:\\s?[–-]\\s?\\d{1,3}(?:[,.]\\d{1,2})?)?\\s?%`,
  "gu"
);
const RATE = new RegExp(`${ALONE_BEFORE}\\d{1,2}[,.]\\d{1,4}${ALONE_AFTER}`, "gu");
const POSTAL = /(?<![\p{L}\d-])\d{2}-\d{3}(?![\p{L}\d-])/gu;
// A year of 4 digits (1900–2199) is part of the dates, order numbers and invoice numbers of business text.
const YEAR = /(?<!\p{L})(?:19|20|21)\d{2}/gu;
const CURRENCY = String.raw`(?:zł|zl|pln|eur|usd|gbp|chf|czk|euro|euros|dolar\p{L}*|złot\p{L}*|[€$£])`;
const AMOUNT = String.raw`((?:\d{1,3}(?:[ .,]\d{3})+|\d+))(?:[,.]\d{1,2})?`;
const AMOUNT_AFTER = new RegExp(`(?<!\\p{L}|\\d[ .,])${AMOUNT}\\s?${CURRENCY}(?![\\p{L}\\d])`, "giu");
const AMOUNT_BEFORE = new RegExp(`(?<![\\p{L}\\d])${CURRENCY}\\s?${AMOUNT}(?!\\p{L})`, "giu");
/** The most integer digits of an amount that are free. */
export const AMOUNT_FREE_DIGITS = 9;
/** The most digits of all such numbers of a body that are free: a list of rates is free, a number cut into pieces is not. */
export const SHAPED_FREE_TOTAL = 40;

// A phone-like run of digits: spaces, dashes, dots and brackets between digits.
const PHONE_RUN = /\d[\d ()[\].-]*\d/g;

/** The IBAN length of each country of the registry (IBAN_LENGTHS of the 84 registry examples, plus BI, DJ and NI). */
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BI: 27,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DJ: 27,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FK: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MN: 20,
  MR: 27,
  MT: 31,
  MU: 30,
  NI: 28,
  NL: 18,
  NO: 15,
  OM: 23,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  SA: 24,
  SC: 31,
  SD: 18,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  SO: 23,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
  YE: 30,
};

interface Run {
  start: number;
  end: number;
  digits: string;
}

function runsOf(view: string): Run[] {
  return [...view.matchAll(/\d+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, digits: m[0] }));
}

function isDate(day: string, month: string, year: string): boolean {
  const [d, m, y] = [Number(day), Number(month), Number(year)];
  return d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= 2199;
}

/** The places of the view that lie inside a valid date, a valid time or a quarter. */
function dateTimePlaces(view: string): Set<number> {
  const places = new Set<number>();
  const cover = (start: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) places.add(start + i);
  };
  for (const m of view.matchAll(DATE_DMY))
    if (isDate(m[1] as string, m[2] as string, m[3] as string)) cover(m.index, m[0]);
  for (const m of view.matchAll(DATE_YMD))
    if (isDate(m[3] as string, m[2] as string, m[1] as string)) cover(m.index, m[0]);
  for (const m of view.matchAll(DATE_WORDS)) if (isDate(m[1] as string, "1", m[2] as string)) cover(m.index, m[0]);
  for (const m of view.matchAll(PERIOD)) if (isDate("1", "1", m[1] as string)) cover(m.index, m[0]);
  for (const m of view.matchAll(TIME)) {
    if (Number(m[1]) <= 23 && Number(m[2]) <= 59 && (m[3] === undefined || Number(m[3]) <= 59)) cover(m.index, m[0]);
  }
  return places;
}

// The digit key of every number token of a text: the digits of one token, and the digits of a chain of tokens that
// hold digits and follow each other ("PL61 1090 1014 …" is also "61109010…").
function numberKeys(view: string): string[] {
  const keys: string[] = [];
  let chain = "";
  for (const token of view.split(/\s+/)) {
    const digits = token.replace(/\D/g, "");
    if (digits === "") {
      chain = "";
      continue;
    }
    keys.push(digits);
    chain += digits;
    if (chain !== digits) keys.push(chain);
  }
  return keys;
}

function typedKeysOf(texts: readonly string[]): string[] {
  return texts.flatMap((text) => numberKeys(plainView(text)));
}

// The numbers of the quoted mail that an order number may be: 9 to 12 digits in one run.
function mailKeysOf(texts: readonly string[]): string[] {
  return texts
    .flatMap((text) => runsOf(plainView(text)).map((run) => run.digits))
    .filter((digits) => digits.length >= MAIL_KNOWN_MIN_DIGITS && digits.length <= MAIL_KNOWN_MAX_DIGITS);
}

// The letters and digits of a view without any separator and quote mark. A word breaks the stream (`?`):
// a group of letters that is longer than 4 (bank codes have at most 4 letters in a group) and every letter of another
// script. A group with a digit never breaks it.
function alnumStream(view: string): string {
  let out = "";
  for (const token of skeleton(view).match(/[A-Za-z0-9]+|[\p{L}\p{N}]/gu) ?? []) {
    // A word breaks the stream but keeps its last two letters: "plnNL" is a currency word glued to a country code.
    if (/^[A-Za-z]{5,}$/.test(token)) out += `?${token.slice(-2).toUpperCase()}`;
    else if (/^[^A-Za-z0-9]$/.test(token)) out += "?";
    else out += token.toUpperCase();
  }
  return out;
}

function mod97(iban: string): number {
  let rest = 0;
  for (const char of `${iban.slice(4)}${iban.slice(0, 4)}`) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest;
}

const MARKUP_TAG = /<\/?[a-z][a-z0-9]*[^>]*>/gi;

/** The IBANs of a text: a registry country code, two digits and the characters of the length of that country, mod 97. */
export function ibansOf(text: string): string[] {
  const found = new Set<string>();
  for (const view of viewsOf(text)) {
    // Once as it is and once without markup tags ("<b>GI74</b>"): the letters of a tag are no part of the number.
    for (const stream of [alnumStream(view), alnumStream(view.replace(MARKUP_TAG, " "))]) {
      for (let start = 0; start < stream.length; start += 1) {
        const length = IBAN_LENGTHS[stream.slice(start, start + 2)] ?? 0;
        if (!/^\d{2}$/.test(stream.slice(start + 2, start + 4))) continue;
        const candidate = stream.slice(start, start + length);
        if (candidate.length === length && /^[A-Z0-9]+$/.test(candidate) && mod97(candidate) === 1)
          found.add(candidate);
      }
    }
  }
  return [...found];
}

export interface DigitVerdict {
  /** The digits that cost something are above the budget, or an IBAN that the user did not type is in the body. */
  account: boolean;
  phone: boolean;
}

// The matches of the numbers that have the form of money (two decimals), a percentage, a rate, a postal code or a year.
function shapedMatches(view: string): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  for (const m of view.matchAll(MONEY)) {
    if ((m[1] as string).replace(/\D/g, "").length <= AMOUNT_FREE_DIGITS)
      found.push({ start: m.index, end: m.index + m[0].length });
  }
  for (const pattern of [PERCENT, RATE, POSTAL, YEAR]) {
    for (const m of view.matchAll(pattern)) found.push({ start: m.index, end: m.index + m[0].length });
  }
  return found.sort((x, y) => x.start - y.start);
}

// The matches of the amounts next to a currency, with the side of the digits that has no currency.
function amountMatches(view: string): { start: number; end: number; digits: number; currencyFirst: boolean }[] {
  const found: { start: number; end: number; digits: number; currencyFirst: boolean }[] = [];
  for (const [pattern, currencyFirst] of [
    [AMOUNT_AFTER, false],
    [AMOUNT_BEFORE, true],
  ] as const) {
    for (const m of view.matchAll(pattern)) {
      const digits = (m[1] as string).replace(/\D/g, "").length;
      if (digits <= AMOUNT_FREE_DIGITS)
        found.push({ start: m.index, end: m.index + m[0].length, digits, currencyFirst });
    }
  }
  return found.sort((x, y) => x.start - y.start);
}

// The indexes of the runs that lie inside a place.
function runsInside(runs: readonly Run[], start: number, end: number): number[] {
  return runs.map((run, i) => (run.start >= start && run.end <= end ? i : -1)).filter((i) => i >= 0);
}

/** For each run of a view: does it cost nothing? */
function freeRuns(view: string, runs: readonly Run[], known: (digits: string) => boolean): boolean[] {
  const dated = dateTimePlaces(view);
  const free = runs.map((run) => known(run.digits) || dated.has(run.start));
  // Only these runs (typed, from the mail, a date or a time) may stand next to an amount.
  const explained = [...free];
  let freeDigits = 0;
  for (const item of shapedMatches(view)) {
    const inside = runsInside(runs, item.start, item.end);
    const digits = inside.reduce((sum, i) => sum + (runs[i] as Run).digits.length, 0);
    if (freeDigits + digits > SHAPED_FREE_TOTAL) continue;
    freeDigits += digits;
    for (const i of inside) free[i] = true;
  }
  // An amount next to a currency stands alone: the run on its side without a currency is no unexplained digit run in
  // the same stretch without a letter ("USD 4111 1111 1111 1111" is no amount).
  for (const amount of amountMatches(view)) {
    const inside = runsInside(runs, amount.start, amount.end);
    const edge = amount.currencyFirst ? Math.max(...inside) + 1 : Math.min(...inside) - 1;
    const neighbour = runs[edge];
    const gap =
      neighbour === undefined
        ? ""
        : amount.currencyFirst
          ? view.slice(amount.end, neighbour.start)
          : view.slice(neighbour.end, amount.start);
    const blocked = neighbour !== undefined && !explained[edge] && !/\p{L}/u.test(gap);
    if (blocked || freeDigits + amount.digits > SHAPED_FREE_TOTAL) continue;
    freeDigits += amount.digits;
    for (const i of inside) free[i] = true;
  }
  return free;
}

/**
 * The digit budget of a body. `allowed` holds the texts that the user typed (instruction, signature, writing style);
 * `quoted` holds the mail that the draft answers.
 */
export function digitVerdict(
  body: string,
  opts: { allowed: readonly string[]; quoted?: readonly string[] }
): DigitVerdict {
  const typed = typedKeysOf(opts.allowed);
  const mail = mailKeysOf(opts.quoted ?? []);
  const known = (digits: string): boolean =>
    digits.length >= KNOWN_MIN_DIGITS && [...typed, ...mail].some((key) => key.includes(digits));
  let cost = 0;
  let phone = false;
  for (const view of viewsOf(body)) {
    const runs = runsOf(view);
    const free = freeRuns(view, runs, known);
    cost = Math.max(
      cost,
      runs.reduce((sum, run, i) => sum + (free[i] ? 0 : run.digits.length), 0)
    );
    // A free run leaves a break: a phone number does not join across it.
    let rest = view;
    for (let i = runs.length - 1; i >= 0; i -= 1) {
      const run = runs[i] as Run;
      if (free[i]) rest = `${rest.slice(0, run.start)}${SEPARATOR}${rest.slice(run.end)}`;
    }
    for (const m of rest.matchAll(PHONE_RUN)) {
      if (m[0].replace(/\D/g, "").length >= PHONE_DIGITS) phone = true;
    }
  }
  const typedIbans = new Set(opts.allowed.flatMap(ibansOf));
  const iban = ibansOf(body).some((candidate) => !typedIbans.has(candidate));
  const account = cost > DIGIT_BUDGET || iban;
  return { account, phone: phone && !account };
}
