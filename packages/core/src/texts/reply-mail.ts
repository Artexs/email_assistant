import type { UserLocale } from "../tenancy";

// The lines that our code adds to the mail of a reply draft. The body is the text of the user; the only added line is the
// header of the quote. The language is the language of the draft, not of the user: `textTables[language].replyMail`.
export interface ReplyMailTexts {
  // `date` is the local day and time of the original (`formatDateLabel`); `name` is the display name of its sender, or its address.
  quoteHeader: (date: string, name: string) => string;
}

export const replyMailTexts = {
  en: {
    quoteHeader: (date, name) => `On ${date}, ${name} wrote:`,
  },
  pl: {
    quoteHeader: (date, name) => `${date} ${name} napisał(a):`,
  },
} satisfies Record<UserLocale, ReplyMailTexts>;
