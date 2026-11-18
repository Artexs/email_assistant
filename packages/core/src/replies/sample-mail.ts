// The fixed sample mail of the style preview (F115 stage 10). It is a constant: the preview never reads a real mail. The model
// answers it in the language of the owner, so the owner sees the name, the signature and the style in a draft.

export interface SampleMail {
  subject: string;
  fromName: string;
  fromAddress: string;
  body: string;
}

export const SAMPLE_MAIL = {
  pl: {
    subject: "Spotkanie w sprawie oferty",
    fromName: "Anna Kowalska",
    fromAddress: "anna.kowalska@example.com",
    body: [
      "Dzień dobry,",
      "",
      "dziękuję za rozmowę w zeszłym tygodniu. Czy możemy spotkać się w przyszłym tygodniu, żeby omówić ofertę?",
      "Proszę o informację, który dzień Panu odpowiada.",
      "",
      "Pozdrawiam,",
      "Anna Kowalska",
    ].join("\n"),
  },
  en: {
    subject: "Meeting about the offer",
    fromName: "Anna Kowalska",
    fromAddress: "anna.kowalska@example.com",
    body: [
      "Hello,",
      "",
      "thank you for the call last week. Can we meet next week to talk about the offer?",
      "Please tell me which day suits you.",
      "",
      "Best regards,",
      "Anna Kowalska",
    ].join("\n"),
  },
} as const satisfies Record<"pl" | "en", SampleMail>;
