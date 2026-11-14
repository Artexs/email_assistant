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
  answered: AnsweredCheckTexts;
}

// The answered check at the end of the /review page (F100 stage 15). One colon at most per line.
export interface AnsweredCheckTexts {
  // `count` is the number of mails in the block; the text asks one question for all of them.
  block: (count: number) => string;
  yesButton: (n: number) => string;
  noButton: (n: number) => string;
  savedYes: string;
  savedNo: string;
  already: string;
  off: string;
}

export const reviewTexts = {
  en: {
    header: (count) =>
      `Review: ${count} ${count === 1 ? "mail" : "mails"} without a label (random sample of the last 30 days). Tap ✅ when the AI category is right, ✏️ to correct it.`,
    empty: "Nothing to review: every recent mail has a label.",
    off: "This command is not on for your account.",
    noMailbox: "No mailbox.",
    answered: {
      block: (count) =>
        `You replied to ${count} ${count === 1 ? "mail" : "mails"} that the assistant did not mark "needs reply". Did ${count === 1 ? "it" : "they"} need a reply?`,
      yesButton: (n) => `✅ Yes ${n}`,
      noButton: (n) => `➖ No ${n}`,
      savedYes: "Saved: it needed a reply.",
      savedNo: "Saved: no reply needed.",
      already: "Already answered.",
      off: "This button is off now.",
    },
  },
  pl: {
    header: (count) =>
      `Przegląd: ${count} ${PL_MAILS[pluralCategory("pl", count)]} bez etykiety (losowa próbka z ostatnich 30 dni). Stuknij ✅, gdy kategoria AI jest trafna, albo ✏️, aby ją poprawić.`,
    empty: "Brak wiadomości do przeglądu: każda wiadomość z ostatnich 30 dni ma etykietę.",
    off: "To polecenie nie jest włączone dla Twojego konta.",
    noMailbox: "Brak skrzynki.",
    answered: {
      // The question has no number: "wymagała" (one) or "wymagały" (the other forms) follows the noun "wiadomość".
      block: (count) => {
        const one = pluralCategory("pl", count) === "one";
        return `Na ${count} ${PL_MAILS[pluralCategory("pl", count)]} odpowiedziano, a asystent ${one ? "jej" : "ich"} nie oznaczył jako „do odpowiedzi”. Czy ${one ? "wymagała" : "wymagały"} odpowiedzi?`;
      },
      yesButton: (n) => `✅ Tak ${n}`,
      noButton: (n) => `➖ Nie ${n}`,
      savedYes: "Zapisano: wiadomość wymagała odpowiedzi.",
      savedNo: "Zapisano: odpowiedź nie była potrzebna.",
      already: "Już odpowiedziano.",
      off: "Ten przycisk jest teraz wyłączony.",
    },
  },
} satisfies Record<UserLocale, ReviewTexts>;
