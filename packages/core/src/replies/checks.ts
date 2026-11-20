// The code checks of a reply body (ADR 0033 §3). The drafter's text is untrusted: it is stored and shown only
// when every check passes. Pure code. Each check scans every view of the text (`views.ts`).
import { digitVerdict } from "./digits";
import { type EntityCode, findEntities } from "./entities";
import { hasBrokenGapSyntax, withoutGaps } from "./gaps";
import { detectLanguage } from "./language";
import { collapse, skeleton, viewsOf } from "./views";

export const REPLY_CHECK_CODES = [
  "address",
  "link",
  "phone",
  "account_number",
  "blank_lines",
  "header_line",
  "control_chars",
  "too_long",
  "language",
  "gap_syntax",
] as const;
export type ReplyCheckCode = (typeof REPLY_CHECK_CODES)[number];

export const DRAFT_MAX_CHARS = 2000;
// An answer with no common word of either language passes only when it is shorter than this.
export const UNKNOWN_LANGUAGE_MAX_CHARS = 80;
const MAX_BLANK_LINES = 2;

export type ReplyCheckResult = { ok: true } | { ok: false; failures: ReplyCheckCode[] };

// Names of the header lines that a mail client or a parser could read as a header (English and Polish).
const HEADER_NAMES = ["from", "to", "cc", "bcc", "subject", "reply-to", "date", "od", "do", "dw", "temat", "data"];
const HEADER_LINE = new RegExp(String.raw`^[\s>|]*(?:${HEADER_NAMES.join("|")})\s*:(?:\s|$)`, "i");
const LINE_BREAK = /\r\n?|\n|\u2028|\u2029|\u0085/;

// Control characters: C0 and C1 controls except LF and tab, format characters (bidi, zero width, soft hyphen, tags),
// line and paragraph separators, private use and lone surrogates. A CR or CRLF is a line break, not a control character.
const CONTROL = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\u2028\u2029]/u;

export function hasControlChars(body: string): boolean {
  return CONTROL.test(body.replace(/[\r\n\t]/g, ""));
}

// A blank line holds only white space and characters that show nothing: every default-ignorable code point (zero
// width and format characters, the Hangul fillers, the combining grapheme joiner, variation selectors, the soft hyphen,
// the Khmer inherent vowels, tags), the Braille blank, the object replacement character, the musical null notehead
// and the Khitan filler. 50 lines of U+2800 look
// like a gap of white paper (CVE-2026-55145).
const INVISIBLE = [
  String.raw`\p{Default_Ignorable_Code_Point}`,
  String.raw`\u2800`,
  String.raw`\ufffc`,
  String.raw`\u{1d159}`,
  String.raw`\u{16fe4}`,
];
const BLANK = `(?:[^\\S\\n]|${INVISIBLE.join("|")})*`;
const BLANK_RUN = new RegExp(String.raw`\n${BLANK}(?:\n${BLANK}){${MAX_BLANK_LINES + 1},}`, "u");

function hasLongBlankRun(body: string): boolean {
  return BLANK_RUN.test(`\n${body.replace(/\r\n?|\u2028|\u2029|\u0085/g, "\n")}`);
}

function hasHeaderLine(body: string): boolean {
  for (const view of viewsOf(body)) {
    for (const line of skeleton(view).split(LINE_BREAK)) {
      if (HEADER_LINE.test(line)) return true;
    }
  }
  return false;
}

// The entities of the user's own text (instruction, signature, writing style) may appear in the body.
function allowedKeys(allowed: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const text of allowed) for (const entity of findEntities(text)) keys.add(`${entity.code}:${entity.key}`);
  return keys;
}

function entityFailures(body: string, allowed: readonly string[]): Set<EntityCode> {
  const permitted = allowedKeys(allowed);
  const failures = new Set<EntityCode>();
  for (const entity of findEntities(body)) {
    if (!permitted.has(`${entity.code}:${entity.key}`)) failures.add(entity.code);
  }
  return failures;
}

function languageFails(body: string, language: "pl" | "en"): boolean {
  const text = withoutGaps(body);
  const detected = detectLanguage(text);
  if (detected === language) return false;
  return !(detected === "unknown" && collapse(text).length < UNKNOWN_LANGUAGE_MAX_CHARS);
}

/** The codes of the detectors of a text that another module may reuse: addresses, links, phone and account numbers. */
export type SensitiveCode = "address" | "link" | "phone" | "account_number";

/** Which of the four detectors find something in the body that `allowed` does not hold. The order is stable. */
export function sensitiveFailures(
  body: string,
  allowed: readonly string[],
  quoted?: readonly string[]
): SensitiveCode[] {
  const failed = new Set<string>(entityFailures(body, allowed));
  const digits = digitVerdict(body, { allowed, quoted });
  if (digits.account) failed.add("account_number");
  if (digits.phone) failed.add("phone");
  return (["address", "link", "phone", "account_number"] as const).filter((code) => failed.has(code));
}

/**
 * Runs every check on the body. `allowed` holds the texts that the user typed: the instruction, the signature and the
 * writing style; an address, link, phone number or account number that is in them passes. The failures come in the
 * order of `REPLY_CHECK_CODES`.
 */
export function checkReplyBody(
  body: string,
  opts: { language: "pl" | "en"; allowed: readonly string[]; quoted?: readonly string[] }
): ReplyCheckResult {
  const failed = new Set<ReplyCheckCode>(sensitiveFailures(body, opts.allowed, opts.quoted));
  if (hasLongBlankRun(body)) failed.add("blank_lines");
  if (hasHeaderLine(body)) failed.add("header_line");
  if (hasControlChars(body)) failed.add("control_chars");
  if ([...body].length > DRAFT_MAX_CHARS) failed.add("too_long");
  if (languageFails(body, opts.language)) failed.add("language");
  if (hasBrokenGapSyntax(body)) failed.add("gap_syntax");
  const failures = REPLY_CHECK_CODES.filter((code) => failed.has(code));
  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}
