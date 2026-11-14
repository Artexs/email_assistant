import type { UndoAnswerKind } from "../digest/answers";
import type { UserLocale } from "../tenancy";

// The texts that Telegram and the web panel show after a tap. The Polish texts equal the panel texts.
export interface AnswerTexts {
  undo: Record<UndoAnswerKind, string>;
  right: (saved: boolean, category: string) => string;
  pick: (saved: boolean) => string;
  picked: (saved: boolean, trueCategory: string, aiCategory: string) => string;
}

export const answerTexts = {
  en: {
    undo: {
      started: "↩️ Undo started: the mail goes back within a minute.",
      already: "Undo was already requested for this mail.",
      nothing: "Nothing to undo.",
      too_old: "Too old to undo (7 days).",
      held: "Undo is not possible now: mailbox changes are off or the mailbox is paused.",
    },
    right: (saved, category) => (saved ? `✅ Saved: ${category} is right.` : "Already saved."),
    pick: (saved) => (saved ? "Saved." : "Already saved."),
    picked: (saved, trueCategory, aiCategory) =>
      `✏️ ${saved ? "Saved" : "Already saved"}: ${trueCategory} (AI said ${aiCategory}).`,
  },
  pl: {
    undo: {
      started: "↩️ Cofanie rozpoczęte: wiadomość wróci w ciągu minuty.",
      already: "Cofnięcie tej wiadomości zostało już zgłoszone.",
      nothing: "Nie ma czego cofnąć.",
      too_old: "Za późno na cofnięcie (limit 7 dni).",
      held: "Cofnięcie jest teraz niemożliwe: zmiany w skrzynce są wyłączone albo skrzynka jest wstrzymana.",
    },
    right: (saved, category) => (saved ? `✅ Zapisano: ${category} – dobrze.` : "Już zapisano."),
    pick: (saved) => (saved ? "Zapisano." : "Już zapisano."),
    picked: (saved, trueCategory, aiCategory) =>
      `✏️ ${saved ? "Zapisano" : "Już zapisano"}: ${trueCategory} (propozycja AI: ${aiCategory}).`,
  },
} satisfies Record<UserLocale, AnswerTexts>;
