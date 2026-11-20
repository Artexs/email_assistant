// The 7-day limit is for the mail that the assistant classifies. The earlier mails of the thread go along as context, with no
// age limit (`listThreadContext` in `apps/server/src/modules/mail/repo/lookup.ts` filters only on `received_at`). A text that names
// the 7-day limit must say that it is about the classified mail and name the thread context, so a reader cannot take the limit for
// all mail that the AI gets.

const SEVEN_DAYS =
  /older than 7 days|up to 7 days old|7-day limit|starszej niż 7 dni|starszych niż 7 dni|starsze niż 7 dni|limit 7 dni/i;
const CONTEXT = /context|kontekst/i;
const CLASSIFIED = /classif|klasyfik/i;

/** The texts that name the 7-day limit and do not name both the thread context and the classified mail, in input order. */
export function sevenDayLimitProblems(texts: readonly string[]): string[] {
  return texts.filter((text) => SEVEN_DAYS.test(text) && !(CONTEXT.test(text) && CLASSIFIED.test(text)));
}
