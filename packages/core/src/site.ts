// The product name and the public docs site address. One source for the docs app, the panel and the checks.

import type { UserLocale } from "./tenancy";

export const PRODUCT_NAME = "Email Assistant";
export const DOCS_ORIGIN = "https://artexs.github.io";
export const DOCS_BASE = "/email_assistant";

/**
 * Absolute URL of a docs page or file. English has no locale prefix; `pl` adds `/pl`.
 * `path` is the locale-free site path. It starts with `/`, holds no `..` segment, and ends with `/` for a page.
 * A file path (the last segment has an extension, such as `/pagefind/pagefind.js`) needs no trailing `/`.
 * A `?query` or `#anchor` after the path stays as it is.
 * A `pl` path never starts with `/pl/`: the function adds that prefix itself.
 */
export function docsUrl(path: string, locale: UserLocale): string {
  if (!path.startsWith("/")) throw new Error(`docsUrl path must start with "/": ${path}`);
  const pathOnly = path.split(/[?#]/, 1)[0] ?? path;
  const segments = pathOnly.split("/");
  if (segments.includes("..")) throw new Error(`docsUrl path must not hold a ".." segment: ${path}`);
  const lastSegment = segments[segments.length - 1] ?? "";
  if (lastSegment !== "" && !lastSegment.includes(".")) {
    throw new Error(`docsUrl page path must end with "/": ${path}`);
  }
  if (locale === "pl" && (pathOnly === "/pl" || pathOnly.startsWith("/pl/"))) {
    throw new Error(`docsUrl path already holds the "/pl" prefix: ${path}`);
  }
  const prefix = locale === "pl" ? "/pl" : "";
  return `${DOCS_ORIGIN}${DOCS_BASE}${prefix}${path}`;
}

/** The placeholder price of the one plan, in US dollars per mailbox per month. The pricing page and `docs/cost-model.md` both read it. */
export const PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH = 25;
