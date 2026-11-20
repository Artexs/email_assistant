// What the stylist must return, and the code checks of its text. The text is untrusted: the owner sees it only when
// every check passes, and it never holds a name, a contact, a quote or the text of a sample. Pure code.
import { z } from "zod";

import { hasControlChars, sensitiveFailures } from "./checks";
import { detectLanguage } from "./language";

export const STYLE_SUGGESTION_MAX_CHARS = 1000;
export const STYLE_OUTPUT_MAX_CHARS = 4000;
/** The suggestion must not hold this many words in a row from one sample. */
export const STYLE_COPY_WORDS = 8;
// Polish forms of a name share their first letters: "Anna", "Annie", "Annę".
const NAME_STEM_CHARS = 4;

export const STYLE_CHECK_CODES = [
  "address",
  "link",
  "phone",
  "account_number",
  "control_chars",
  "quote_line",
  "copied_text",
  "name",
  "too_long",
  "language",
] as const;
export type StyleCheckCode = (typeof STYLE_CHECK_CODES)[number];

export type StyleCheckResult = { ok: true } | { ok: false; failures: StyleCheckCode[] };

// Strict: an extra or a missing key is a schema failure. A text over the check limit still parses, so that the
// failure is a check failure with a retry.
export const stylistOutputSchema = z
  .object({
    style: z
      .string()
      .trim()
      .min(1)
      .refine((text) => Array.from(text).length <= STYLE_OUTPUT_MAX_CHARS, { message: "style is too long" }),
  })
  .strict();
export type StylistOutput = z.infer<typeof stylistOutputSchema>;

const WORDS = /[\p{L}\p{N}]+/gu;
const CAPITALISED = /^\p{Lu}\p{L}*\p{Ll}\p{L}*$/u;

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(WORDS) ?? [];
}

function windows(words: readonly string[]): Set<string> {
  const found = new Set<string>();
  for (let i = 0; i + STYLE_COPY_WORDS <= words.length; i += 1) {
    found.add(words.slice(i, i + STYLE_COPY_WORDS).join(" "));
  }
  return found;
}

function copiesSample(text: string, samples: readonly string[]): boolean {
  const mine = [...windows(wordsOf(text))];
  if (mine.length === 0) return false;
  return samples.some((sample) => {
    const theirs = windows(wordsOf(sample));
    return mine.some((window) => theirs.has(window));
  });
}

// The stems of a name: its first letters, and the first letters without the mobile vowel of "-ek" and "-ec" names
// ("Marek" gives "mare" and "mark", so "Marku" and "Marka" match).
function stemsOf(name: string): string[] {
  const stems = [name.slice(0, NAME_STEM_CHARS)];
  if (/e[kc]$/.test(name)) stems.push(`${name.slice(0, -2)}${name.slice(-1)}`.slice(0, NAME_STEM_CHARS));
  return stems;
}

function holdsName(text: string, names: readonly string[]): boolean {
  const exact = new Set(names);
  const stems = new Set(names.filter((name) => name.length >= NAME_STEM_CHARS).flatMap(stemsOf));
  for (const word of text.match(/\p{L}+/gu) ?? []) {
    if (!CAPITALISED.test(word)) continue;
    const lower = word.toLowerCase();
    if (exact.has(lower)) return true;
    if (lower.length >= NAME_STEM_CHARS && stems.has(lower.slice(0, NAME_STEM_CHARS))) return true;
  }
  return false;
}

/**
 * Runs every check on the suggested text. `names` and `samples` come from `buildStyleSamples`. No allowed list: an
 * address, a link or a number fails whatever the user typed. The failures come in the order of `STYLE_CHECK_CODES`.
 */
export function checkStyleSuggestion(
  text: string,
  opts: { names: readonly string[]; samples: readonly string[]; language: "pl" | "en" }
): StyleCheckResult {
  const failed = new Set<StyleCheckCode>(sensitiveFailures(text, []));
  if (hasControlChars(text)) failed.add("control_chars");
  if (text.split(/\r\n?|\n|\u2028|\u2029|\u0085/).some((line) => line.trimStart().startsWith(">"))) {
    failed.add("quote_line");
  }
  if (copiesSample(text, opts.samples)) failed.add("copied_text");
  if (holdsName(text, opts.names)) failed.add("name");
  if (Array.from(text).length > STYLE_SUGGESTION_MAX_CHARS) failed.add("too_long");
  const detected = detectLanguage(text);
  if (detected !== "unknown" && detected !== opts.language) failed.add("language");
  const failures = STYLE_CHECK_CODES.filter((code) => failed.has(code));
  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}
