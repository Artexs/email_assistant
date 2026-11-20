import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { dataCategories, subprocessors, userLocales, type UserLocale } from "@ea/core/web";

import { en } from "../i18n/en";
import { pl } from "../i18n/pl";

import { isAllowedPlaceholder, legalDocs, type LegalDoc } from "./legal";

// Checks of the legal Markdown sources. Test use only: it reads files with Node APIs, so no island
// imports it.

const here = dirname(fileURLToPath(import.meta.url));
export const legalSourceRoot = join(here, "..", "legal");

export function legalSourcePath(lang: UserLocale, doc: LegalDoc): string {
  return join(legalSourceRoot, lang, `${doc}.md`);
}

export function readLegalSource(lang: UserLocale, doc: LegalDoc): string {
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
  const expected = new Set(userLocales.flatMap((lang) => legalDocs.map((doc) => `${lang}/${doc}.md`)));
  return userLocales
    .flatMap((lang) => readdirSync(join(legalSourceRoot, lang)).map((file) => `${lang}/${file}`))
    .filter((file) => !expected.has(file));
}

// SHA-256 (hex) of the parts, in the given order. A part is read with LF line ends, so a checkout with CRLF gives the same
// digest. A zero byte ends each part, so ["ab"] and ["a", "b"] differ.
export function legalTextsDigest(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part.replace(/\r\n/g, "\n"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

// The texts that the version guard covers, in a fixed order: the six Markdown files (languages, then documents, as in
// `userLocales` and `legalDocs`), both registries as JSON, then the `en` and `pl` value of every `legal_*` key (sorted by
// key) and of `tg_consent_text`.
export function legalTextParts(): string[] {
  const keys = [...Object.keys(en).filter((key) => key.startsWith("legal_")), "tg_consent_text"].sort();
  const texts = (table: Record<string, string>) => keys.map((key) => `${key}=${table[key] ?? ""}`);
  return [
    ...userLocales.flatMap((lang) => legalDocs.map((doc) => readLegalSource(lang, doc))),
    JSON.stringify(subprocessors),
    JSON.stringify(dataCategories),
    ...texts(en),
    ...texts(pl),
  ];
}
