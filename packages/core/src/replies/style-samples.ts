// The samples of a sent mail that the style suggestion reads, and the names that the answer must not hold. Pure code.
import { cutChars } from "./input";
import { cutQuotedReply } from "./style-cut";

/** One sent mail. The addresses feed only the name check; they never go into a prompt. */
export interface StyleSource {
  bodyText: string;
  toAddresses: string[];
  ccAddresses: string[];
}

export const STYLE_SAMPLE_MAX_CHARS = 1500;
export const STYLE_SAMPLES_MAX_CHARS = 40 * STYLE_SAMPLE_MAX_CHARS;
/** The suggestion needs at least this many samples. */
export const STYLE_MIN_SAMPLES = 5;
/** The most sent mails that one suggestion reads. */
export const STYLE_MAX_SOURCES = 100;

const GREETINGS = ["dear", "hi", "hello", "cześć", "witam", "pan", "pani", "panie"];
const WEEKDAYS = [
  ...["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
  ...["poniedziałek", "poniedziałku", "wtorek", "wtorku", "środa", "środę", "środy", "środzie", "czwartek"],
  ...["czwartku", "piątek", "piątku", "sobota", "sobotę", "soboty", "niedziela", "niedzielę", "niedzieli"],
];
const MONTHS = [
  ...["january", "february", "march", "april", "may", "june", "july", "august", "september", "october"],
  ...["november", "december"],
  ...["styczeń", "stycznia", "luty", "lutego", "marzec", "marca", "kwiecień", "kwietnia", "maj", "maja"],
  ...["czerwiec", "czerwca", "lipiec", "lipca", "sierpień", "sierpnia", "wrzesień", "września"],
  ...["październik", "października", "listopad", "listopada", "grudzień", "grudnia"],
];
const NAME_STOP = new Set([
  ...["pan", "pani", "pana", "panu", "panią", "panie", "państwo", "państwa", "państwu"],
  ...["i", "mr", "mrs", "ms", "dr", "english", "polish"],
  ...WEEKDAYS,
  ...MONTHS,
]);

const ADDRESS_PIECE = /^\p{L}{3,}$/u;
const WORD = /\p{L}+/gu;
// A capitalised word: an upper-case first letter and at least one lower-case letter ("OK" and "PDF" are no name).
const CAPITALISED = /^\p{Lu}\p{L}*\p{Ll}\p{L}*$/u;
// What may stand between the start of a line and a word that still starts the sentence: an opening mark.
const OPENING = /["'“„([\-–•*\s]+$/u;

function recipientTokens(source: StyleSource): string[] {
  return [...source.toAddresses, ...source.ccAddresses].flatMap((address) =>
    (address.split("@")[0] ?? "")
      .split(/[._+-]/)
      .filter((piece) => ADDRESS_PIECE.test(piece))
      .map((piece) => piece.toLowerCase())
  );
}

function startsSentence(line: string, index: number): boolean {
  const before = line.slice(0, index).replace(OPENING, "");
  return before === "" || /[.!?…]$/.test(before);
}

function textTokens(text: string): string[] {
  const found: string[] = [];
  for (const line of text.split("\n")) {
    const words = [...line.matchAll(WORD)];
    words.forEach((match, i) => {
      const word = match[0];
      if (!CAPITALISED.test(word)) return;
      const previous = words[i - 1]?.[0].toLowerCase() ?? "";
      const afterGreeting = GREETINGS.includes(previous);
      if (afterGreeting || !startsSentence(line, match.index)) found.push(word.toLowerCase());
    });
  }
  return found;
}

/**
 * The tokens of the names in the sent mail: the local-part pieces of each recipient address with 3 or more letters,
 * the capitalised word after a greeting, and every capitalised word that does not start a sentence or a line. Lower
 * case, unique, sorted. Known limit: a name that the texts never show capitalised in mid-sentence passes.
 */
export function styleNameTokens(sources: readonly StyleSource[]): string[] {
  const tokens = new Set<string>();
  for (const source of sources) {
    for (const token of recipientTokens(source)) tokens.add(token);
    for (const token of textTokens(cutQuotedReply(source.bodyText, { signature: null }))) tokens.add(token);
  }
  return [...tokens].filter((token) => token.length >= 2 && !NAME_STOP.has(token)).sort();
}

/**
 * The texts that go to the model: each sent text cut by `cutQuotedReply`, empty ones dropped, the input order kept
 * (newest first), each cut to `STYLE_SAMPLE_MAX_CHARS`, and no more than `STYLE_SAMPLES_MAX_CHARS` in all. `names`
 * holds the name tokens of the mails that made a sample.
 */
export function buildStyleSamples(
  sources: readonly StyleSource[],
  opts: { signature: string | null }
): { samples: string[]; names: string[] } {
  const samples: string[] = [];
  const used: StyleSource[] = [];
  let total = 0;
  for (const source of sources) {
    const text = cutChars(cutQuotedReply(source.bodyText, opts), STYLE_SAMPLE_MAX_CHARS);
    if (text === "") continue;
    const size = Array.from(text).length;
    if (total + size > STYLE_SAMPLES_MAX_CHARS) break;
    total += size;
    samples.push(text);
    used.push({ ...source, bodyText: text });
  }
  return { samples, names: styleNameTokens(used) };
}
