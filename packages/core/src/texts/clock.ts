import type { UserLocale } from "../tenancy";

export interface ClockTexts {
  months: readonly string[]; // 12 entries, index 0 = January
  weekdays: readonly string[]; // 7 entries, index 0 = Sunday
}

export const clockTexts = {
  en: {
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  },
  pl: {
    months: ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"],
    weekdays: ["niedz.", "pon.", "wt.", "śr.", "czw.", "pt.", "sob."],
  },
} satisfies Record<UserLocale, ClockTexts>;
