import type { UserLocale } from "../tenancy";

import { pluralCategory } from "./locale";

const PL_MAILS = { one: "wiadomość", few: "wiadomości", many: "wiadomości", other: "wiadomości" } as const;

// The texts of the /review page (F097 D4, D5). The help line, the menu entry and the picker are in `bot.ts`.
export interface ReviewTexts {
  // `count` is the number of mails on the page.
  header: (count: number) => string;
  empty: string;
  off: string;
  noMailbox: string;
}

export const reviewTexts = {
  en: {
    header: (count) =>
      `Review: ${count} ${count === 1 ? "mail" : "mails"} without a label (random sample of the last 30 days). Tap ✅ when the AI category is right, ✏️ to correct it.`,
    empty: "Nothing to review: every recent mail has a label.",
    off: "This command is not on for your account.",
    noMailbox: "No mailbox.",
  },
  pl: {
    header: (count) =>
      `Przegląd: ${count} ${PL_MAILS[pluralCategory("pl", count)]} bez etykiety (losowa próbka z ostatnich 30 dni). Stuknij ✅, gdy kategoria AI jest trafna, albo ✏️, aby ją poprawić.`,
    empty: "Brak wiadomości do przeglądu: każda wiadomość z ostatnich 30 dni ma etykietę.",
    off: "To polecenie nie jest włączone dla Twojego konta.",
    noMailbox: "Brak skrzynki.",
  },
} satisfies Record<UserLocale, ReviewTexts>;
