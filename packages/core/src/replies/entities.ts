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

// An IBAN: two letters, two check digits, then 11 to 30 letters or digits (spaces allowed). At least 10 of its
// characters are digits, so a word run such as "MA12 reply tomorrow please" is no account number.
const IBAN = /(?<![A-Za-z0-9])[A-Za-z]{2}\d{2}(?:[ -]?[A-Za-z0-9]){11,30}(?![A-Za-z0-9])/g;

// A number that is no phone: a date, a time or an amount. The code cuts these out before it counts the digits of a
// phone. It never cuts an amount before the account scan: an account number next to "zł" or "$" is still an account
// number (BEC fraud: a new account number in a draft).
const DATE_DMY = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?!\d)/g;
const DATE_YMD = /(?<!\d)(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/g;
const TIME = /(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)/g;
const NUMBER = String.raw`\d{1,3}(?:[ .]\d{3})*[,.]\d{1,2}(?!\d)|\d+[,.]\d{1,2}(?!\d)|\d+(?: \d{3})*`;
const CURRENCY = String.raw`(?:zł|zl|pln|eur|usd|gbp|chf|czk|euro|euros|dolar\w*|złot\w*|[€$£])`;
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
// A run of 13 or more digits: a card or an account number. It also spans line breaks, slashes, underscores and a comma
// between two digits, so a split number is one run.
const ACCOUNT_RUN = /(?<!\d)\d(?:(?:[\s.\-/_()[\]|]|(?<=\d),(?=\d))*\d){12,}/g;

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

function numberEntities(view: string): Entity[] {
  const found: Entity[] = [];
  // 1. An IBAN, on the uncut text. The key stops at the last digit, so a word after the number is no part of it.
  let rest = view.replace(IBAN, (match) => {
    if (digitsOf(match).length < 10) return match;
    const key = match
      .replace(/[ -]/g, "")
      .toUpperCase()
      .replace(/[A-Z]+$/, "");
    found.push({ code: "account_number", key });
    return SEPARATOR;
  });
  // 2. A run of 13 or more digits, with dates cut (a range of two dates is no account number) but no amount cut.
  rest = cutDates(rest).replace(ACCOUNT_RUN, (match) => {
    found.push({ code: "account_number", key: digitsOf(match) });
    return SEPARATOR;
  });
  // 3. A phone number: 9 to 12 digits that are no time and no amount.
  rest = rest.replace(TIME, SEPARATOR).replace(AMOUNT, SEPARATOR);
  for (const match of rest.matchAll(DIGIT_RUN)) {
    if (digitsOf(match[0]).length >= 9) found.push({ code: "phone", key: digitsOf(match[0]) });
  }
  return found;
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
