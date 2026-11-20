// The language of a draft: a count of the most common words of Polish and English. Pure code.

// The 30 most common words of each language. A word that both languages use ("to", "a", "i", "do", "on", "no") is
// left out, so a hit counts for one language only. `checks.test.ts` checks both lists.
// English also holds the greeting and topic words of the reply drafts ("dear", "hi", "regarding"): a short draft
// whose other words are all in gaps still reads as English.
export const POLISH_WORDS = [
  "nie",
  "się",
  "na",
  "w",
  "z",
  "że",
  "jak",
  "ale",
  "po",
  "co",
  "tak",
  "za",
  "od",
  "czy",
  "jest",
  "już",
  "tylko",
  "mnie",
  "dla",
  "bardzo",
  "proszę",
  "dziękuję",
  "będzie",
  "mam",
  "może",
  "jeszcze",
  "pana",
  "pani",
  "dobry",
  "dzień",
] as const;

export const ENGLISH_WORDS = [
  "the",
  "of",
  "and",
  "in",
  "is",
  "you",
  "that",
  "it",
  "for",
  "with",
  "as",
  "this",
  "be",
  "are",
  "at",
  "have",
  "not",
  "we",
  "will",
  "can",
  "your",
  "but",
  "if",
  "me",
  "my",
  "from",
  "thanks",
  "please",
  "hello",
  "would",
  "dear",
  "hi",
  "regarding",
] as const;

const POLISH = new Set<string>(POLISH_WORDS);
const ENGLISH = new Set<string>(ENGLISH_WORDS);

export type DetectedLanguage = "pl" | "en" | "unknown";

/** `pl` or `en` when its common words hit more often; `unknown` for no hit or a tie. */
export function detectLanguage(text: string): DetectedLanguage {
  let pl = 0;
  let en = 0;
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (POLISH.has(word)) pl += 1;
    if (ENGLISH.has(word)) en += 1;
  }
  if (pl > en) return "pl";
  if (en > pl) return "en";
  return "unknown";
}
