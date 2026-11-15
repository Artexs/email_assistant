// The entities that a reply body must not hold unless the user typed them: addresses, links, phone numbers and
// account numbers. `findEntities` scans every view of the text (see `views.ts`). Pure code.
import { collapse, skeleton, viewsOf } from "./views";

export type EntityCode = "address" | "link" | "phone" | "account_number";

export interface Entity {
  code: EntityCode;
  /** The compare key: lower case, white space collapsed; digits only for a phone; no spaces for an account. */
  key: string;
}

// `jan@firma.pl`, also in quotes, in angle brackets and after `mailto:`.
const ADDRESS = /[^\s@<>()[\],;:"'`]+@[^\s@<>()[\],;:"'`]+\.[^\s@<>()[\],;:"'`]+/g;

// Any `scheme://` (also with a lookalike letter), `www.`, schemes without slashes and bare domains on common TLDs.
const SCHEME = /[^\s:/]{1,20}:\/\/\S+/g;
const SCHEME_NO_SLASHES = /\b(?:mailto|tel|javascript|data|file|ftp|sms|callto|vbscript|ssh):\S+/gi;
const WWW = /\bwww\.[^\s<>"')\]]+/gi;
const TLDS =
  "com|net|org|pl|eu|io|info|biz|co|de|uk|ru|cn|xyz|top|app|dev|online|site|ly|me|tv|cc|ai|example|test|gov|edu|fr|nl|cz|sk|ua|us|tk|ml|ga|cf|gq|link|click|shop|store|cloud|page|live|work|tech";
const BARE_DOMAIN = new RegExp(
  `(?<![\\w@.%;-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})(?![\\w-])(?:/\\S*)?`,
  "gi"
);

// The country codes of the IBAN registry. An IBAN starts with one of them and two check digits.
const IBAN_COUNTRIES = new Set(
  "AD AE AL AT AZ BA BE BG BH BI BR BY CH CR CY CZ DE DJ DK DO EE EG ES FI FK FO FR GB GE GI GL GR GT HR HU IE IL IQ IS IT JO KW KZ LB LC LI LT LU LV LY MC MD ME MK MN MR MT MU NI NL NO OM PK PL PS PT QA RO RS RU SA SC SD SE SI SK SM SO ST SV TL TN TR UA VA VG XK YE".split(
    " "
  )
);
// Words that are an IBAN country code and an ordinary word ("do 31.12.2026", "by 15 May", "no 12"). In lower case
// and apart from the check digits they are no IBAN start.
const WORD_CODES = new Set(["do", "no", "it", "is", "be", "at", "me", "so", "by", "mu", "ye"]);
// An IBAN has 15 to 34 characters: a country code, 2 check digits and 11 to 30 letters or digits, 10 digits or more.
const IBAN_MIN = 15;
const IBAN_MAX = 34;
const IBAN_MIN_DIGITS = 10;
// A joiner between two groups: 1 to 3 characters that are no letter and no digit (white space, line breaks,
// punctuation, symbols, marks and invisible characters).
const JOINER_MAX = 3;

// A number that is no phone: a date, a time or an amount. The code cuts these out before it counts the digits of a
// phone. It never cuts an amount before the account scan: an account number next to "zł" or "$" is still an account
// number (BEC fraud: a new account number in a draft).
const DATE_DMY = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?!\d)/g;
const DATE_YMD = /(?<!\d)(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/g;
const TIME = /(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)/g;
const NUMBER = String.raw`\d{1,3}(?:[ .]\d{3})*[,.]\d{1,2}(?!\d)|\d+[,.]\d{1,2}(?!\d)|\d+(?: \d{3})*`;
const CURRENCY = String.raw`(?:zł|zl|pln|eur|usd|gbp|chf|czk|euro|euros|dolar\p{L}*|złot\p{L}*|[€$£])`;
// The match has at most 12 digits: every run of 13 or more digits is an account number and is gone before this cut.
const AMOUNT = new RegExp(
  [
    `(?<!\\p{L})${CURRENCY}\\s?(?:${NUMBER})`,
    `(?<!\\d)(?:${NUMBER})\\s?${CURRENCY}(?![\\p{L}\\d])`,
    String.raw`(?<!\d)\d{1,3}(?:[ .]\d{3})*[,.]\d{2}(?!\d)`,
  ].join("|"),
  "giu"
);

// A run of digits that allows spaces, dashes, dots, brackets and a leading plus: a phone number.
const DIGIT_RUN = /(?<!\d)\+?[([]?\d[\d ()[\].-]*\d/g;
// A cut leaves this text: no run of digits can join across it.
const SEPARATOR = " ; ";

function trimTail(text: string): string {
  return text.replace(/[.,;:!?)\]}>"'`]+$/, "");
}

function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

function linksOf(view: string): Entity[] {
  const found: Entity[] = [];
  const seen = skeleton(view);
  for (const pattern of [SCHEME, SCHEME_NO_SLASHES, WWW, BARE_DOMAIN]) {
    for (const match of seen.matchAll(pattern)) found.push({ code: "link", key: collapse(trimTail(match[0])) });
  }
  return found;
}

function isDate(day: string, month: string, year: string): boolean {
  const [d, m, y] = [Number(day), Number(month), Number(year)];
  return d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900 && y <= 2199;
}

// A date that exists on a calendar page (day 1–31, month 1–12, year 1900–2199) is cut out. Another group of digits
// with dots or dashes stays.
function cutDates(text: string): string {
  return text
    .replace(DATE_DMY, (match, d: string, m: string, y: string) => (isDate(d, m, y) ? SEPARATOR : match))
    .replace(DATE_YMD, (match, y: string, m: string, d: string) => (isDate(d, m, y) ? SEPARATOR : match));
}

// The place of every digit that sits inside a date or a time (valid ones): a run of digits is no account number when
// the dates and times cover ALL of its digits (a date range is one run of 16 digits).
function dateDigitPlaces(view: string): Set<number> {
  const places = new Set<number>();
  const cover = (start: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) places.add(start + i);
  };
  for (const m of view.matchAll(DATE_DMY))
    if (isDate(m[1] as string, m[2] as string, m[3] as string)) cover(m.index, m[0]);
  for (const m of view.matchAll(DATE_YMD))
    if (isDate(m[3] as string, m[2] as string, m[1] as string)) cover(m.index, m[0]);
  for (const m of view.matchAll(TIME)) {
    const [hours, minutes] = m[0].split(":").map(Number) as [number, number];
    if (hours <= 23 && minutes <= 59) cover(m.index, m[0]);
  }
  return places;
}

// One chain of the account view: the letters and digits of consecutive groups, with the 1–3 characters between two
// groups left out. `at[i]` is the place of character `i` in the view.
interface Chain {
  text: string;
  at: number[];
  /** The places in `text` where a group starts. */
  starts: Set<number>;
}

// A group is a run of ASCII letters and digits. It joins the chain of the group before it when 1 to 3 characters that
// are no letter and no digit lie between them. A letter of another script between two groups (Polish prose, "zł") ends
// the chain. This one view finds every way to write a number with separators: spaces, dots, slashes, commas, line
// breaks and any other character of the class; it needs no list of separators.
function chainsOf(view: string): Chain[] {
  const chains: Chain[] = [];
  let current: Chain | null = null;
  let previousEnd = -1;
  for (const group of view.matchAll(/[A-Za-z0-9]+/g)) {
    const gap = previousEnd < 0 ? "" : view.slice(previousEnd, group.index);
    const joins = [...gap].length <= JOINER_MAX && /^[^\p{L}\p{N}]+$/u.test(gap);
    if (current === null || !joins) {
      current = { text: "", at: [], starts: new Set() };
      chains.push(current);
    }
    // A group right after a letter of another script is the end of a Polish word ("Nakład" → "Nak" and "ad"), not a
    // group of its own.
    if (group.index === 0 || !/[\p{L}\p{N}]/u.test(view[group.index - 1] as string))
      current.starts.add(current.text.length);
    current.text += group[0];
    for (let i = 0; i < group[0].length; i += 1) current.at.push(group.index + i);
    previousEnd = group.index + group[0].length;
  }
  return chains;
}

// The account numbers of a view and the places (start, end) that they cover. The scan runs on the uncut text: an
// amount next to the number hides nothing. A date or a time exempts a run of digits only when it covers all digits.
function accountNumbers(view: string): { entities: Entity[]; spans: [number, number][] } {
  const entities: Entity[] = [];
  const spans: [number, number][] = [];
  const dated = dateDigitPlaces(view);
  const allDated = (chain: Chain, from: number, to: number): boolean => {
    for (let i = from; i < to; i += 1) {
      if (/\d/.test(chain.text[i] as string) && !dated.has(chain.at[i] as number)) return false;
    }
    return true;
  };
  const add = (chain: Chain, from: number, to: number, key: string): void => {
    entities.push({ code: "account_number", key });
    spans.push([chain.at[from] as number, (chain.at[to - 1] as number) + 1]);
  };
  for (const chain of chainsOf(view)) {
    // 13 or more digits in a row (a card, a bank account number).
    for (const run of chain.text.matchAll(/\d{13,}/g)) {
      if (!allDated(chain, run.index, run.index + run[0].length))
        add(chain, run.index, run.index + run[0].length, run[0]);
    }
    // An IBAN may start at a group or inside a group (a word glued to it changes nothing). It exists when the first
    // characters that hold 10 digits make 15 characters or more. The key is the whole text up to 34 characters, without
    // letters at its end.
    for (let start = 0; start + IBAN_MIN <= chain.text.length; start += 1) {
      if (!/^[A-Za-z]{2}\d{2}/.test(chain.text.slice(start, start + 4))) continue;
      // The start is a group start, or the code and the check digits are in one group ("kontoNL91…"). A code that is a
      // group of its own, apart from its check digits ("NL 91 ABNA"), is no word of the text: a word such as
      // "do 31.12.2026" or "No 12" is no IBAN. A word that ends with two letters of a country code and a group of digits after it
      // ("dniach 15", "jest 18") is no start.
      const inOneGroup = ![1, 2, 3].some((offset) => chain.starts.has(start + offset));
      const code = chain.text.slice(start, start + 2);
      if (
        !inOneGroup &&
        !(chain.starts.has(start) && (code === code.toUpperCase() || !WORD_CODES.has(code.toLowerCase())))
      )
        continue;
      if (!IBAN_COUNTRIES.has(code.toUpperCase())) continue;
      let digits = 0;
      let end = start;
      while (
        end < Math.min(chain.text.length, start + IBAN_MAX) &&
        (digits < IBAN_MIN_DIGITS || end - start < IBAN_MIN)
      ) {
        if (/\d/.test(chain.text[end] as string)) digits += 1;
        end += 1;
      }
      if (digits < IBAN_MIN_DIGITS || end - start < IBAN_MIN) continue;
      const last = Math.min(chain.text.length, start + IBAN_MAX);
      add(
        chain,
        start,
        last,
        chain.text
          .slice(start, last)
          .toUpperCase()
          .replace(/[A-Z]+$/, "")
      );
    }
  }
  return { entities, spans };
}

function numberEntities(view: string): Entity[] {
  const { entities, spans } = accountNumbers(view);
  // A phone number: 9 to 12 digits that are no account number, no date, no time and no amount.
  let rest = view;
  for (const [start, end] of [...spans].sort((a, b) => b[0] - a[0])) {
    rest = `${rest.slice(0, start)}${SEPARATOR}${rest.slice(end)}`;
  }
  rest = cutDates(rest).replace(TIME, SEPARATOR).replace(AMOUNT, SEPARATOR);
  for (const match of rest.matchAll(DIGIT_RUN)) {
    if (digitsOf(match[0]).length >= 9) entities.push({ code: "phone", key: digitsOf(match[0]) });
  }
  return entities;
}

/** Every address, link, phone number and account number in the text, in every view. */
export function findEntities(text: string): Entity[] {
  const found: Entity[] = [];
  for (const view of viewsOf(text)) {
    for (const match of view.matchAll(ADDRESS)) found.push({ code: "address", key: collapse(trimTail(match[0])) });
    found.push(...linksOf(view), ...numberEntities(view));
  }
  return found;
}
