import type { UserLocale } from "@ea/core/web";

export const legalDocs = ["privacy", "terms", "dpa"] as const;
export type LegalDoc = (typeof legalDocs)[number];

export function legalPath(lang: UserLocale, doc: LegalDoc): string {
  return `/legal/${lang}/${doc}`;
}

// The placeholders that a legal text may hold: no person, company or address is named in a public repo. A text
// writes one with a backslash before `<`, so Markdown prints it as text. `<to confirm: …>` is the other allowed form.
export const legalPlaceholders = [
  "<provider name>",
  "<address>",
  "<contact>",
  "<backup retention>",
  "<organization name>",
] as const;

const toConfirm = /^<to confirm: [^<>\n]+>$/;

export function isAllowedPlaceholder(placeholder: string): boolean {
  return (legalPlaceholders as readonly string[]).includes(placeholder) || toConfirm.test(placeholder);
}

// A text with `{name}` slots, filled from `values`. The legal pages are built at build time and have no i18n runtime.
export function fillSlots(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (slot, name: string) => (name in values ? String(values[name]) : slot));
}
