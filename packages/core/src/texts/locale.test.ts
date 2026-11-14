import { describe, expect, test } from "bun:test";

import { firstLanguageTag, localeOfLanguageTag, pluralCategory, resolveLocale, type PluralCategory } from "./locale";

describe("localeOfLanguageTag", () => {
  test("a tag that starts with pl is Polish; everything else is English", () => {
    for (const tag of ["pl", "pl-PL", "PL", " pl-pl ", "plx"]) expect(localeOfLanguageTag(tag)).toBe("pl");
    for (const tag of ["en-US", "de", "", null, undefined]) expect(localeOfLanguageTag(tag)).toBe("en");
  });
});

describe("resolveLocale", () => {
  test("the stored choice wins over the language tag", () => {
    expect(resolveLocale("en", "pl-PL")).toBe("en");
    expect(resolveLocale("pl", "en-US")).toBe("pl");
    expect(resolveLocale(null, "pl-PL")).toBe("pl");
    expect(resolveLocale(null, undefined)).toBe("en");
  });
});

describe("firstLanguageTag", () => {
  test("takes the first tag without its q value", () => {
    expect(firstLanguageTag("pl-PL,pl;q=0.9,en;q=0.8")).toBe("pl-PL");
    expect(firstLanguageTag("en;q=0.5, pl")).toBe("en");
    expect(firstLanguageTag("*")).toBe("*");
  });

  test("an empty header gives null", () => {
    expect(firstLanguageTag("  ")).toBeNull();
    expect(firstLanguageTag("")).toBeNull();
    expect(firstLanguageTag(undefined)).toBeNull();
  });
});

describe("pluralCategory", () => {
  test("Polish has one, few and many; a fraction is many", () => {
    const counts = [0, 1, 2, 4, 5, 12, 14, 21, 22, 25, 112, 1.5];
    const expected: PluralCategory[] = [
      "many",
      "one",
      "few",
      "few",
      "many",
      "many",
      "many",
      "many",
      "few",
      "many",
      "many",
      "many",
    ];
    expect(counts.map((count) => pluralCategory("pl", count))).toEqual(expected);
  });

  test("English has one and other", () => {
    expect([0, 1, 2].map((count) => pluralCategory("en", count))).toEqual(["other", "one", "other"]);
  });
});
