import { useSyncExternalStore } from "react";
import { localeOfLanguageTag, pluralCategory, type UserLocale } from "@ea/core/web";

import { en, enPlurals, type PluralKey, type TextKey } from "./en";

export type { PluralKey, TextKey };
export type Dictionary = Record<TextKey, string>;
export interface PluralTables {
  en: Record<PluralKey, { one: string; other: string }>;
  pl: Record<PluralKey, { one: string; few: string; many: string }>;
}

type Vars = Record<string, string | number>;

// Until the Polish tables exist, Polish shows the English texts (spec/features/active/F098-e7-t1-polish-ui-i18n-frame-first).
const dictionaries: Record<UserLocale, Dictionary> = { en, pl: en };
const plurals: PluralTables = {
  en: enPlurals,
  pl: Object.fromEntries(
    Object.entries(enPlurals).map(([key, forms]) => [key, { one: forms.one, few: forms.other, many: forms.other }])
  ) as PluralTables["pl"],
};

export const LOCALE_STORAGE_KEY = "ea.locale";

let current: UserLocale = "en";
const listeners = new Set<() => void>();

function isLocale(value: unknown): value is UserLocale {
  return value === "pl" || value === "en";
}

function setDocumentLang(locale: UserLocale): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

export function getLocale(): UserLocale {
  return current;
}

// A change persists the choice, sets `<html lang>` and notifies the islands. The same value does nothing.
export function setLocale(locale: UserLocale): void {
  if (locale === current) return;
  current = locale;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // A blocked storage only loses the choice after a reload.
  }
  setDocumentLang(locale);
  for (const listener of [...listeners]) listener();
}

// The stored choice, else the browser language. It never writes storage and notifies nobody.
export function initLocale(): UserLocale {
  let stored: string | null = null;
  try {
    if (typeof localStorage !== "undefined") stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    stored = null;
  }
  const tag = typeof navigator === "undefined" ? null : navigator.language;
  current = isLocale(stored) ? stored : localeOfLanguageTag(tag);
  setDocumentLang(current);
  return current;
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLocale(): UserLocale {
  return useSyncExternalStore(subscribeLocale, getLocale, () => "en");
}

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function t(key: TextKey, vars?: Vars): string {
  return fill(dictionaries[current][key], vars);
}

// `pluralCategory` gives en one | other and pl one | few | many.
export function tp(key: PluralKey, count: number, vars?: Vars): string {
  const category = pluralCategory(current, count);
  const forms: Record<string, string> = current === "pl" ? plurals.pl[key] : plurals.en[key];
  return fill(forms[category] ?? "", { count, ...vars });
}

export function dateLocale(): "pl-PL" | "en-GB" {
  return current === "pl" ? "pl-PL" : "en-GB";
}

// Tests only: set the locale without storage or the document.
export function setLocaleForTest(locale: UserLocale): void {
  current = locale;
}

if (typeof window !== "undefined") initLocale();
