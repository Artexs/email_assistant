export const legalLangs = ["pl", "en"] as const;
export const legalDocs = ["privacy", "terms", "dpa"] as const;
export type LegalLang = (typeof legalLangs)[number];
export type LegalDoc = (typeof legalDocs)[number];

// The legal pages come in the browser language: Polish for `pl` (any case), English for everything else.
export function legalLang(navigatorLanguage: string | undefined): LegalLang {
  return navigatorLanguage?.toLowerCase().startsWith("pl") === true ? "pl" : "en";
}

export function legalPath(lang: LegalLang, doc: LegalDoc): string {
  return `/legal/${lang}/${doc}`;
}
