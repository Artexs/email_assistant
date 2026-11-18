import type { TextKey } from "../en";

// The phone channel: the offline page of the installed panel.
export const plPhone = {
  offline_title: "Brak połączenia",
  offline_text: "Panel potrzebuje połączenia z siecią, żeby pokazać Twoje dane. Sprawdź połączenie i spróbuj ponownie.",
  offline_retry: "Spróbuj ponownie",
} satisfies Partial<Record<TextKey, string>>;
