// The panel's own text for a doc page: `<UiText k="nav_settings" />` renders it in the page language.
// The lookup runs at build time and throws, because `astro check` does not type-check MDX.
import type { UserLocale } from "@ea/core";
import { en } from "@ea/web/i18n/en";
import { pl } from "@ea/web/i18n/pl";

const PLACEHOLDER = /\{[A-Za-z_][A-Za-z0-9_]*\}/;

// `root` (the English site) and every other locale read `en`; `pl` reads `pl`.
export function uiText(
  key: string,
  locale: string | undefined,
  texts: Record<UserLocale, Record<string, string>> = { en, pl }
): string {
  if (!Object.hasOwn(texts.en, key)) throw new Error(`ui_text_unknown ${key}`);
  // Both languages are checked: a placeholder in one of them would show raw on a page.
  if (PLACEHOLDER.test(texts.en[key] ?? "") || PLACEHOLDER.test(texts.pl[key] ?? "")) {
    throw new Error(`ui_text_has_vars ${key}`);
  }
  return texts[locale === "pl" ? "pl" : "en"][key] ?? "";
}
