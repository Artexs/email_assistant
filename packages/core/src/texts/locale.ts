import type { UserLocale } from "../tenancy";

const pluralRules: Record<UserLocale, Intl.PluralRules> = {
  en: new Intl.PluralRules("en"),
  pl: new Intl.PluralRules("pl"),
};

// "pl", "pl-PL", "PL" → pl; anything else, empty or missing → en.
export function localeOfLanguageTag(tag: string | null | undefined): UserLocale {
  return tag?.trim().toLowerCase().startsWith("pl") ? "pl" : "en";
}

// The stored choice wins; else the language tag decides.
export function resolveLocale(userLocale: UserLocale | null, tag: string | null | undefined): UserLocale {
  return userLocale ?? localeOfLanguageTag(tag);
}

// The first tag of an Accept-Language header, without its q value. Empty → null.
export function firstLanguageTag(acceptLanguage: string | null | undefined): string | null {
  const first = acceptLanguage?.split(",")[0]?.split(";")[0]?.trim();
  return first ? first : null;
}

export type PluralCategory = "one" | "few" | "many" | "other";

// en: one | other. pl: one | few | many (a fraction, Intl's "other", becomes "many").
export function pluralCategory(locale: UserLocale, count: number): PluralCategory {
  const category = pluralRules[locale].select(count);
  if (locale === "pl") return category === "one" || category === "few" ? category : "many";
  return category === "one" ? "one" : "other";
}
