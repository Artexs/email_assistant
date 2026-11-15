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

// A number that is no phone: a date, a time or an amount. The code cuts these out before it counts digits.
const DATE_DMY = /(?<!\d)\d{1,2}[./-]\d{1,2}[./-]\d{4}(?!\d)/g;
const DATE_YMD = /(?<!\d)\d{4}[./-]\d{1,2}[./-]\d{1,2}(?!\d)/g;
const TIME = /(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)/g;
const NUMBER = String.raw`\d{1,3}(?:[ .]\d{3})*[,.]\d{1,2}(?!\d)|\d+[,.]\d{1,2}(?!\d)|\d+(?: \d{3})*`;
const CURRENCY = String.raw`(?:zł|zl|pln|eur|usd|gbp|chf|czk|euro|euros|dolar\w*|złot\w*|[€$£])`;
const AMOUNT = new RegExp(
  [
    `(?<!\\p{L})${CURRENCY}\\s?(?:${NUMBER})`,
    `(?<!\\d)(?:${NUMBER})\\s?${CURRENCY}(?![\\p{L}\\d])`,
    String.raw`(?<!\d)\d{1,3}(?:[ .]\d{3})*[,.]\d{2}(?!\d)`,
  ].join("|"),
  "giu"
);

// A run of digits that allows spaces, dashes, dots, brackets and a leading plus.
const DIGIT_RUN = /(?<!\d)\+?[([]?\d[\d ()[\].-]*\d/g;

const SEPARATOR = " | ";

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

function numberEntities(view: string): Entity[] {
  let rest = view
    .replace(DATE_DMY, SEPARATOR)
    .replace(DATE_YMD, SEPARATOR)
    .replace(TIME, SEPARATOR)
    .replace(AMOUNT, SEPARATOR);
  const found: Entity[] = [];
  rest = rest.replace(IBAN, (match) => {
    if (digitsOf(match).length < 10) return match;
    found.push({ code: "account_number", key: match.replace(/[ -]/g, "").toUpperCase() });
    return SEPARATOR;
  });
  for (const match of rest.matchAll(DIGIT_RUN)) {
    const digits = digitsOf(match[0]);
    if (digits.length >= 13) found.push({ code: "account_number", key: digits });
    else if (digits.length >= 9) found.push({ code: "phone", key: digits });
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
