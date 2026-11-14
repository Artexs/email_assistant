import { describe, expect, test } from "bun:test";

import { textTables, textsFor } from "./index";

describe("the texts registry", () => {
  test("the hold: every locale gets English", () => {
    expect(textsFor("en")).toBe(textTables.en);
    expect(textsFor("pl")).toBe(textTables.en); // stage 12 of the Polish UI plan changes this case
    expect(textTables.pl.locale).toBe("pl");
    expect(textTables.en.locale).toBe("en");
  });

  // Sample arguments for the text functions: they cover each branch of the texts.
  const samples: unknown[][] = [
    [true],
    [false],
    [true, "A"],
    [false, "A"],
    [true, "A", "B"],
    [false, "A", "B"],
    ["A", "B", 62],
  ];

  // Walks a table: a string is non-empty, an array holds such values, a function returns a non-empty string.
  function walk(path: string, value: unknown, seen: string[]): void {
    seen.push(path);
    if (typeof value === "string") {
      expect(value.length, path).toBeGreaterThan(0);
    } else if (Array.isArray(value)) {
      expect(value.length, path).toBeGreaterThan(0);
      value.forEach((item, index) => walk(`${path}[${index}]`, item, seen));
    } else if (typeof value === "function") {
      const results = samples.flatMap((args) => {
        if (args.length !== value.length) return [];
        const result: unknown = value(...args);
        return [result];
      });
      expect(results.length, path).toBeGreaterThan(0);
      for (const result of results) {
        expect(typeof result, path).toBe("string");
        expect((result as string).length, path).toBeGreaterThan(0);
      }
    } else if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value)) walk(`${path}.${key}`, child, seen);
    } else {
      throw new Error(`${path}: unexpected value`);
    }
  }

  for (const locale of ["en", "pl"] as const) {
    test(`every text of ${locale} is non-empty`, () => {
      const seen: string[] = [];
      walk(locale, textTables[locale], seen);
      expect(seen.length).toBeGreaterThan(30);
    });
  }

  test("both locales have the same keys", () => {
    const keys = (value: unknown, path: string): string[] =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.entries(value).flatMap(([key, child]) => keys(child, `${path}.${key}`))
        : [path];
    expect(keys(textTables.pl, "t")).toEqual(keys(textTables.en, "t"));
  });
});
