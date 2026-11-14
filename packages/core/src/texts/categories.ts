import type { UserLocale } from "../tenancy";
import type { Category } from "../triage/categories";

export type CategoryTexts = Record<Category, string>;

export const categoryTexts = {
  en: {
    urgent: "Urgent",
    needs_reply: "Reply",
    delegation: "Delegate",
    unsure: "Unsure",
    info: "Info",
    notification: "Notification",
    spam: "Spam",
  },
  pl: {
    urgent: "Pilne",
    needs_reply: "Odpowiedz",
    delegation: "Przekaż",
    unsure: "Niepewne",
    info: "Info",
    notification: "Powiadomienie",
    spam: "Spam",
  },
} satisfies Record<UserLocale, CategoryTexts>;
