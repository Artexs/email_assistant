export const legalLangs = ["pl", "en"] as const;
export const legalDocs = ["privacy", "terms", "dpa"] as const;
export type LegalLang = (typeof legalLangs)[number];
export type LegalDoc = (typeof legalDocs)[number];

export function legalPath(lang: LegalLang, doc: LegalDoc): string {
  return `/legal/${lang}/${doc}`;
}
