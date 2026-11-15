import type { UserLocale } from "../tenancy";

// The body of a follow-up mail (open loops feature). The language is the language of the loop, not of the user:
// `textTables[language].followUp` picks it. The mail text is formal Polish ("Dzień dobry"): it goes to other people.
export interface FollowUpTexts {
  // The first follow-up, the second one, and the header line of the quote.
  first: (date: string, subject: string) => string;
  second: (date: string, subject: string) => string;
  quoteHeader: (date: string) => string;
}

export const followUpTexts = {
  en: {
    first: (date, subject) =>
      `Hello,\n\nI am coming back to my message of ${date} about "${subject}". Could you let me know where this stands?`,
    second: (date, subject) =>
      `Hello,\n\nI am writing again about my message of ${date} about "${subject}". I would be grateful for a short answer.`,
    quoteHeader: (date) => `My message of ${date}:`,
  },
  pl: {
    first: (date, subject) =>
      `Dzień dobry,\n\nwracam do mojej wiadomości z ${date} w sprawie „${subject}”. Czy mogę prosić o informację, jak wygląda sprawa?`,
    second: (date, subject) =>
      `Dzień dobry,\n\nponownie piszę w sprawie mojej wiadomości z ${date} („${subject}”). Z góry dziękuję za krótką odpowiedź.`,
    quoteHeader: (date) => `Moja wiadomość z ${date}:`,
  },
} satisfies Record<UserLocale, FollowUpTexts>;
