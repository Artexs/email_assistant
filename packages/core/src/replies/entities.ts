// The entities that a reply body must not hold unless the user typed them: addresses and links. `findEntities` scans
// every view of the text (see `views.ts`). Phone and account numbers are checked by the digit budget (`digits.ts`).
// Pure code.
import { collapse, skeleton, viewsOf } from "./views";

export type EntityCode = "address" | "link";

export interface Entity {
  code: EntityCode;
  /** The compare key: lower case, white space collapsed. */
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

function trimTail(text: string): string {
  return text.replace(/[.,;:!?)\]}>"'`]+$/, "");
}

function linksOf(view: string): Entity[] {
  const found: Entity[] = [];
  const seen = skeleton(view);
  for (const pattern of [SCHEME, SCHEME_NO_SLASHES, WWW, BARE_DOMAIN]) {
    for (const match of seen.matchAll(pattern)) found.push({ code: "link", key: collapse(trimTail(match[0])) });
  }
  return found;
}

/** Every address and link in the text, in every view. */
export function findEntities(text: string): Entity[] {
  const found: Entity[] = [];
  for (const view of viewsOf(text)) {
    for (const match of view.matchAll(ADDRESS)) found.push({ code: "address", key: collapse(trimTail(match[0])) });
    found.push(...linksOf(view));
  }
  return found;
}
