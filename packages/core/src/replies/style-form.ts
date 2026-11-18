import { cleanUserText } from "../outgoing/user-text";

// The guided form above the writing-style field of the style card. `styleFromForm` turns the form into plain
// sentences in the language of the owner. The card puts the text into the writing-style field; the owner edits it and saves it. The
// form keeps no state of its own: only the text is stored. Pure code: no I/O.

export const styleAddressForms = ["formal", "first_name", "mirror"] as const;
export type StyleAddressForm = (typeof styleAddressForms)[number];

export const styleLengths = ["short", "normal"] as const;
export type StyleLength = (typeof styleLengths)[number];

/** The longest greeting or sign-off. The whole text then stays far below the limit of the writing-style field. */
export const STYLE_FORM_LINE_MAX = 60;

export interface StyleForm {
  address: StyleAddressForm;
  /** One line, free. Empty: the text says nothing about the greeting. */
  greeting: string;
  /** One line, free. Empty: the text says nothing about the sign-off. */
  signOff: string;
  length: StyleLength;
}

export type StyleLocale = "pl" | "en";

interface StyleSentences {
  address: Record<StyleAddressForm, string>;
  greeting(text: string): string;
  signOff(text: string): string;
  length: Record<StyleLength, string>;
}

const SENTENCES: Record<StyleLocale, StyleSentences> = {
  pl: {
    address: {
      formal: "Zwracaj się do odbiorcy formalnie: per Pan lub Pani.",
      first_name: "Zwracaj się do odbiorcy po imieniu.",
      mirror: "Zwracaj się do odbiorcy tak, jak nadawca zwraca się do mnie.",
    },
    greeting: (text) => `Zacznij od powitania „${text}”.`,
    signOff: (text) => `Zakończ pożegnaniem „${text}”.`,
    length: {
      short: "Pisz krótko.",
      normal: "Pisz odpowiedzi o zwykłej długości.",
    },
  },
  en: {
    address: {
      formal: "Address the recipient formally.",
      first_name: "Address the recipient by first name.",
      mirror: "Address the recipient the way the sender addresses me.",
    },
    greeting: (text) => `Start with the greeting "${text}".`,
    signOff: (text) => `End with the sign-off "${text}".`,
    length: {
      short: "Keep replies short.",
      normal: "Write replies of normal length.",
    },
  },
};

// One clean line of at most STYLE_FORM_LINE_MAX characters (code points). A control character, a line break and a bidi mark go.
function line(text: string): string {
  return Array.from(cleanUserText(text, { oneLine: true }))
    .slice(0, STYLE_FORM_LINE_MAX)
    .join("")
    .trim();
}

/**
 * The writing-style text for the form, as plain sentences in `locale`, one space between them. An empty greeting or sign-off leaves
 * its sentence out. The text always passes `checkProfileInput` (at most 1,000 characters, no control character).
 */
export function styleFromForm(form: StyleForm, locale: StyleLocale): string {
  const words = SENTENCES[locale];
  const greeting = line(form.greeting);
  const signOff = line(form.signOff);
  return [
    words.address[form.address],
    greeting === "" ? null : words.greeting(greeting),
    signOff === "" ? null : words.signOff(signOff),
    words.length[form.length],
  ]
    .filter((sentence): sentence is string => sentence !== null)
    .join(" ");
}
