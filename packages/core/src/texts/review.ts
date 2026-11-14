import type { UserLocale } from "../tenancy";

// The texts of the /review page taps (F097 D5). The page itself adds its entries here in stage 04.
export interface ReviewTexts {
  // `subject` is the cleaned subject, `aiCategory` the category tag of the AI answer.
  pickerTitle: (subject: string, aiCategory: string) => string;
  cancelButton: string;
  cancelled: string;
}

export const reviewTexts = {
  en: {
    pickerTitle: (subject, aiCategory) => `✏️ Pick the right category\n${subject}\nAI said: ${aiCategory}`,
    cancelButton: "✖️ Cancel",
    cancelled: "✏️ Cancelled.",
  },
  pl: {
    pickerTitle: (subject, aiCategory) => `✏️ Wybierz właściwą kategorię\n${subject}\nPropozycja AI: ${aiCategory}`,
    cancelButton: "✖️ Anuluj",
    cancelled: "✏️ Anulowano.",
  },
} satisfies Record<UserLocale, ReviewTexts>;
