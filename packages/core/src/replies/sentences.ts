// Sentence counts of a reply draft: how much is real text, how much is skeleton (a greeting, a fixed thanks, a
// "Regarding X: [[gap]]" line), and how many sentences lean toward a commitment. A measure only; no check reads it.
// Pure code.

import { replaceGaps } from "./gaps";
import { holdsDateOrTerm, namesReplyDeadline } from "./sentence-shapes";

export interface ReplySentenceCounts {
  /** Sentences with no gap, at least 3 words, and not a fixed thanks. */
  prose: number;
  /** Sentences with a gap that are not the "Regarding X: [[gap]]" template. */
  gapSentences: number;
  /** Sentences of the form "Regarding X: [[gap]]" (or "W sprawie X: [[gap]]"). */
  template: number;
  /**
   * Counted sentences that lean: the text outside the gaps holds a leaning phrase, or a sentence with a gap names the
   * deadline of this reply or of a decision, or restates a date or term outside its gap. A weekday or a month is a
   * term only after a term preposition; a position phrase directly before a gap that ends the sentence is no lean.
   */
  leaning: number;
}

/** Phrases that lean toward a commitment the manager has not made. Matched as whole words, case-insensitive. */
export const LEANING_PHRASES = {
  en: [
    "I would",
    "I will",
    "I'll",
    "we will",
    "we'll",
    "my preference",
    "my position",
    "I agree",
    "I accept",
    "I confirm",
    "I can confirm",
    "I keep",
    "please book",
  ],
  pl: [
    "podtrzymuję",
    "zgadzam się",
    "akceptuję",
    "potwierdzam",
    "wyślę",
    "prześlę",
    "zadzwonię",
    "odezwę się",
    "wrócę",
    "moja preferencja",
    "moje stanowisko",
    "proponuję",
  ],
} as const satisfies { en: readonly string[]; pl: readonly string[] };

/** True when the draft has no real text: no prose and no sentence that mixes text with a gap. */
export function isSkeletonDraft(counts: ReplySentenceCounts): boolean {
  return counts.prose === 0 && counts.gapSentences === 0;
}

// One private-use character stands for a gap, so a `.` in a label never splits a sentence.
const MARKER = "\uE000";
const GREETING_MAX_WORDS = 6;
const PROSE_MIN_WORDS = 3;
// The topic holds no comma, no colon and no word of an answer: "W sprawie X, moja odpowiedź brzmi: [[gap]]" is a gap
// sentence with words of its own, not the fixed template.
const TEMPLATE = new RegExp(
  String.raw`^(?:Regarding|W sprawie) (?:(?!odpowied|answer|brzmi)[^:,]){1,80}: ${MARKER}\.?$`,
  "iu"
);
const ABBREVIATIONS = new Set([
  "np.",
  "godz.",
  "ok.",
  "tj.",
  "nr.",
  "ul.",
  "dr.",
  "e.g.",
  "i.e.",
  "etc.",
  "mr.",
  "ms.",
  "mrs.",
]);
const FIXED_THANKS = new Set(["dziękuję za wiadomość.", "thank you for your email."]);
const SENTENCE_END = /[.!?](?=\s|$)/g;

const LEANING = new RegExp(
  [...LEANING_PHRASES.en, ...LEANING_PHRASES.pl]
    .map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`).replace(/ /g, String.raw`\s+`))
    .map((phrase) => String.raw`(?<![\p{L}\p{N}])${phrase}(?![\p{L}\p{N}])`)
    .join("|"),
  "iu"
);

// A position phrase leans only when words of its own follow it. "Moje stanowisko to [[gap]]" and "my preference is:
// [[gap]]" only name the answer the gap holds; "my preference on the payment terms is: [[gap]]" still counts.
const POSITION_PHRASES = ["moje stanowisko", "moja preferencja", "my position", "my preference"];
const POSITION_BEFORE_GAP_END = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:${POSITION_PHRASES.join("|").replace(/ /g, String.raw`\s+`)})(?![\p{L}\p{N}])(?:\s+(?:to|is|brzmi))?\s*:?\s*${MARKER}\s*[.!?]?$`,
  "iu"
);

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word !== "").length;
}

function isGreeting(line: string): boolean {
  return /[,!]$/.test(line) && wordCount(line) <= GREETING_MAX_WORDS;
}

/** Splits one line after `.`, `!` or `?` that a space or the end follows, except after an abbreviation. */
function sentencesOfLine(line: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const match of line.matchAll(SENTENCE_END)) {
    const end = match.index + 1;
    const lastWord = line.slice(start, end).split(/\s+/).pop() ?? "";
    if (ABBREVIATIONS.has(lastWord.toLowerCase())) continue;
    sentences.push(line.slice(start, end));
    start = end;
  }
  sentences.push(line.slice(start));
  return sentences.map((sentence) => sentence.trim()).filter((sentence) => sentence !== "");
}

/** Counts the sentences of a draft by kind. The greeting line is not counted. */
export function classifyReplySentences(body: string): ReplySentenceCounts {
  const lines = replaceGaps(body, MARKER)
    .replaceAll("’", "'")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines[0] !== undefined && isGreeting(lines[0])) lines.shift();

  const counts: ReplySentenceCounts = { prose: 0, gapSentences: 0, template: 0, leaning: 0 };
  for (const sentence of lines.flatMap(sentencesOfLine)) {
    const outside = sentence.replaceAll(MARKER, " ");
    const leaningText = sentence.replace(POSITION_BEFORE_GAP_END, " ").replaceAll(MARKER, " ");
    let leansByShape = false;
    if (sentence.includes(MARKER)) {
      counts[TEMPLATE.test(sentence) ? "template" : "gapSentences"] += 1;
      leansByShape = namesReplyDeadline(outside) || holdsDateOrTerm(outside);
    } else if (wordCount(sentence) >= PROSE_MIN_WORDS && !FIXED_THANKS.has(sentence.toLowerCase())) {
      counts.prose += 1;
    } else {
      continue;
    }
    if (leansByShape || LEANING.test(leaningText)) counts.leaning += 1;
  }
  return counts;
}
