import type { UserLocale } from "../tenancy";

import { pluralCategory } from "./locale";

const PL_MAILS = { one: "wiadomość", few: "wiadomości", many: "wiadomości", other: "wiadomości" } as const;

// The texts of the /review command (F097 D4, D5): the page, its taps and the lines of the help list and the menu.
export interface ReviewTexts {
  // `count` is the number of mails on the page.
  header: (count: number) => string;
  empty: string;
  off: string;
  noMailbox: string;
  helpLine: string; // one line of the /help list
  commandDescription: string; // the entry of the Telegram command menu
  // `subject` is the cleaned subject, `aiCategory` the category tag of the AI answer.
  pickerTitle: (subject: string, aiCategory: string) => string;
  cancelButton: string;
  cancelled: string;
}

export const reviewTexts = {
  en: {
    header: (count) =>
      `Review: ${count} ${count === 1 ? "mail" : "mails"} without a label (random sample of the last 30 days). Tap ✅ when the AI category is right, ✏️ to correct it.`,
    empty: "Nothing to review: every recent mail has a label.",
    off: "This command is not on for your account.",
    noMailbox: "No mailbox.",
    helpLine: "/review – label a random sample of recent mail",
    commandDescription: "Label a sample of recent mail",
    pickerTitle: (subject, aiCategory) => `✏️ Pick the right category\n${subject}\nAI said: ${aiCategory}`,
    cancelButton: "✖️ Cancel",
    cancelled: "✏️ Cancelled.",
  },
  pl: {
    header: (count) =>
      `Przegląd: ${count} ${PL_MAILS[pluralCategory("pl", count)]} bez etykiety (losowa próbka z ostatnich 30 dni). Stuknij ✅, gdy kategoria AI jest trafna, albo ✏️, aby ją poprawić.`,
    empty: "Nie ma co przeglądać: każda ostatnia wiadomość ma etykietę.",
    off: "To polecenie nie jest włączone dla Twojego konta.",
    noMailbox: "Brak skrzynki.",
    helpLine: "/review – oznacz losową próbkę ostatnich wiadomości",
    commandDescription: "Oznacz próbkę ostatnich wiadomości",
    pickerTitle: (subject, aiCategory) => `✏️ Wybierz właściwą kategorię\n${subject}\nPropozycja AI: ${aiCategory}`,
    cancelButton: "✖️ Anuluj",
    cancelled: "✏️ Anulowano.",
  },
} satisfies Record<UserLocale, ReviewTexts>;
