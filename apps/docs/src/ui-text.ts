// The panel's own text for a doc page (plan D8): `<UiText k="nav_settings" />` renders it in the page language.
// The lookup runs at build time and throws, because `astro check` does not type-check MDX.
import { en } from "@ea/web/i18n/en";
import { pl } from "@ea/web/i18n/pl";

const PLACEHOLDER = /\{[A-Za-z_][A-Za-z0-9_]*\}/;

// `root` (the English site) and every other locale read `en`; `pl` reads `pl`.
export function uiText(key: string, locale: string | undefined): string {
  if (!Object.hasOwn(en, key)) throw new Error(`ui_text_unknown ${key}`);
  const texts = { en, pl } as Record<"en" | "pl", Record<string, string>>;
  // Both languages are checked: a placeholder in one of them would show raw on a page.
  if (PLACEHOLDER.test(texts.en[key] ?? "") || PLACEHOLDER.test(texts.pl[key] ?? "")) {
    throw new Error(`ui_text_has_vars ${key}`);
  }
  return texts[locale === "pl" ? "pl" : "en"][key] ?? "";
}
