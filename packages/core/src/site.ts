// The product name and the public docs site address. One source for the docs app, the panel and the checks.

export const PRODUCT_NAME = "Email Assistant";
export const DOCS_ORIGIN = "https://artexs.github.io";
export const DOCS_BASE = "/email_assistant";

export type DocsLocale = "en" | "pl";

/** Absolute URL of a docs page. `path` starts with `/`; a page path ends with `/`. English has no locale prefix. */
export function docsUrl(path: string, locale: DocsLocale): string {
  if (!path.startsWith("/")) throw new Error(`docsUrl path must start with "/": ${path}`);
  const prefix = locale === "pl" ? "/pl" : "";
  return `${DOCS_ORIGIN}${DOCS_BASE}${prefix}${path}`;
}
