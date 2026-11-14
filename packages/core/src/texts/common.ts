import type { UserLocale } from "../tenancy";

// Words that many notices share: the labels of a mail and the feedback buttons.
export interface CommonTexts {
  from: string; // "From"
  subject: string; // "Subject"
  noSubject: string; // "(no subject)"
  unknownSender: string; // "(unknown sender)"
  unknownAddress: string; // "(unknown)"
  test: string; // "🧪 test"
  right: string;
  change: string;
  undo: string; // the three feedback buttons
}

export const commonTexts = {
  en: {
    from: "From",
    subject: "Subject",
    noSubject: "(no subject)",
    unknownSender: "(unknown sender)",
    unknownAddress: "(unknown)",
    test: "🧪 test",
    right: "✅ Right",
    change: "✏️ Change",
    undo: "↩️ Undo",
  },
  pl: {
    from: "Od",
    subject: "Temat",
    noSubject: "(bez tematu)",
    unknownSender: "(nieznany nadawca)",
    unknownAddress: "(nieznany)",
    test: "🧪 test",
    right: "✅ Dobrze",
    change: "✏️ Zmień",
    undo: "↩️ Cofnij",
  },
} satisfies Record<UserLocale, CommonTexts>;
