// The 7-day limit is for the mail that the assistant classifies. The earlier mails of the thread go along as context, with no
// age limit (`listThreadContext` in `apps/server/src/modules/mail/repo/lookup.ts` filters only on `received_at`). A text that names
// the 7-day limit must say that it is about the classified mail and name the thread context, so a reader cannot take the limit for
// all mail that the AI gets.

// "7" or "seven" in English; "7", "siedem" or the inflected "siedmiu" in Polish. A bare "7 days" is not enough: copies, undo and
// approvals also last 7 days. The pattern needs a word about the age of the mail next to the number.
const EN_7 = "(?:7|seven)";
const PL_7 = "(?:7|siedem|siedmiu)";
const SEVEN_DAYS = new RegExp(
  [
    `older than ${EN_7} days`,
    `${EN_7} days old`,
    `(?:more|longer) than ${EN_7} days`,
    `last ${EN_7} days`,
    `${EN_7}[- ]day (?:limit|rule|window)`,
    `starsz\\p{L}* (?:niż|od) ${PL_7} dni`,
    `sprzed (?:ponad |więcej niż )?${PL_7} dni`,
    `z ostatnich ${PL_7} dni`,
    `(?:limit|reguła|okno) ${PL_7} dni`,
    `${PL_7}-dniow\\p{L}*`,
  ].join("|"),
  "iu"
);
const CONTEXT = /context|kontekst/i;
const CLASSIFIED = /classif|klasyfik/i;

/** The texts that name the 7-day limit and do not name both the thread context and the classified mail, in input order. */
export function sevenDayLimitProblems(texts: readonly string[]): string[] {
  return texts.filter((text) => SEVEN_DAYS.test(text) && !(CONTEXT.test(text) && CLASSIFIED.test(text)));
}
