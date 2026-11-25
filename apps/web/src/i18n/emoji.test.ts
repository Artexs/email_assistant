import { describe, expect, test } from "bun:test";

import { en, enPlurals } from "./en";
import { pl, plPlurals } from "./pl";

// No panel text holds an emoji: a category or a status shows an icon, and a Telegram button is named in words
// (`docs/decisions/0037-panel-design-system.md`, the decision on emoji). The server and Telegram texts keep theirs.
const EMOJI = /\p{Extended_Pictographic}|\uFE0F/u;

type Texts = Record<string, string>;
type PluralTexts = Record<string, Record<string, string>>;

// One line per text or plural form that holds an emoji: `<locale>.<key>[.<form>]: "<emoji>"`.
export function emojiHits(locale: string, texts: Texts, plurals: PluralTexts): string[] {
  const hits: string[] = [];
  const check = (path: string, text: string) => {
    const found = text.match(new RegExp(EMOJI.source, "gu"));
    if (found !== null) hits.push(`${path}: "${found.join("")}"`);
  };
  for (const [key, text] of Object.entries(texts)) check(`${locale}.${key}`, text);
  for (const [key, forms] of Object.entries(plurals)) {
    for (const [form, text] of Object.entries(forms)) check(`${locale}.${key}.${form}`, text);
  }
  return hits;
}

describe("emojiHits", () => {
  test("an emoji in a text is reported with its key", () => {
    expect(emojiHits("en", { cat_help: "Rate with ✅" }, {})).toEqual(['en.cat_help: "✅"']);
  });

  test("an emoji with the variation selector is reported", () => {
    expect(emojiHits("pl", { cat_help: "Zmień ✏\uFE0F" }, {})).toEqual(['pl.cat_help: "✏\uFE0F"']);
  });

  test("arrows, dots and dashes are not emoji", () => {
    expect(emojiHits("en", { saved: "Saved · 3 → 4 – done…" }, {})).toEqual([]);
  });

  test("an emoji in one plural form is reported with its form", () => {
    expect(emojiHits("en", {}, { rule_count: { one: "1 ✅", other: "# ok" } })).toEqual(['en.rule_count.one: "✅"']);
  });
});

describe("the dictionaries", () => {
  test.each([
    ["en", en, enPlurals],
    ["pl", pl, plPlurals],
  ])("no %s text or plural form holds an emoji", (locale, texts, plurals) => {
    expect(emojiHits(locale, texts, plurals as PluralTexts)).toEqual([]);
  });
});
