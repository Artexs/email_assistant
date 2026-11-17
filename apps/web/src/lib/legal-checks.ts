import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isAllowedPlaceholder, legalDocs, legalLangs, type LegalDoc, type LegalLang } from "./legal";

// Checks of the legal Markdown sources (F107 stage 02). Test use only: it reads files with Node APIs, so no island
// imports it.

const here = dirname(fileURLToPath(import.meta.url));
export const legalSourceRoot = join(here, "..", "legal");

export function legalSourcePath(lang: LegalLang, doc: LegalDoc): string {
  return join(legalSourceRoot, lang, `${doc}.md`);
}

export function readLegalSource(lang: LegalLang, doc: LegalDoc): string {
  return readFileSync(legalSourcePath(lang, doc), "utf8");
}

// Every `\<…>` of the text, as the reader sees it (`<…>`), in order.
export function findPlaceholders(markdown: string): string[] {
  return [...markdown.matchAll(/\\(<[^<>\n]+>)/g)].map((match) => match[1] as string);
}

// A `<` that starts a tag, a closing tag, a comment or an autolink. The text writes a placeholder as `\<…>`.
const rawHtml = /(^|[^\\])<[A-Za-z/!?]/m;

// The problems of one source file; an empty list means the file is fine.
export function checkLegalSource(markdown: string): string[] {
  const problems: string[] = [];
  if (rawHtml.test(markdown)) problems.push("raw HTML is not allowed: write a placeholder as \\<name>");
  for (const placeholder of findPlaceholders(markdown))
    if (!isAllowedPlaceholder(placeholder)) problems.push(`placeholder is not in the list: ${placeholder}`);
  return problems;
}

export function headingCount(markdown: string): number {
  return (markdown.match(/^## /gm) ?? []).length;
}

// The text of each `##` heading, in order.
export function headingTitles(markdown: string): string[] {
  return [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1] as string);
}

// The Markdown files under `src/legal` that are not one of the six pages.
export function strayLegalFiles(): string[] {
  const expected = new Set(legalLangs.flatMap((lang) => legalDocs.map((doc) => `${lang}/${doc}.md`)));
  return legalLangs
    .flatMap((lang) => readdirSync(join(legalSourceRoot, lang)).map((file) => `${lang}/${file}`))
    .filter((file) => !expected.has(file));
}
