import type { UserLocale } from "../tenancy";

export interface AiTextTexts {
  triageError: string;
  llmBlocked: string;
  blocklist: string;
  noReason: string;
  guess: (reason: string, guess: string, percent: number) => string;
}

export const aiTextTexts = {
  en: {
    triageError: "AI triage failed 3 times.",
    llmBlocked: "The AI safety filter blocked this mail.",
    blocklist: "The sender is on your blocklist.",
    noReason: "No reason given.",
    guess: (reason, guess, percent) => `${reason} (AI guess: ${guess}, ${percent}%)`,
  },
  pl: {
    triageError: "Klasyfikacja AI nie powiodła się 3 razy.",
    llmBlocked: "Filtr bezpieczeństwa AI zablokował tę wiadomość.",
    blocklist: "Nadawca jest na Twojej liście blokowanych.",
    noReason: "Brak uzasadnienia.",
    guess: (reason, guess, percent) => `${reason} (AI zgaduje: ${guess}, ${percent}%)`,
  },
} satisfies Record<UserLocale, AiTextTexts>;
