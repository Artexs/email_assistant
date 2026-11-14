import { describe, expect, test } from "bun:test";

import { textTables, textsFor } from "./index";

describe("the texts registry", () => {
  test("every locale gets its own table", () => {
    expect(textsFor("en")).toBe(textTables.en);
    expect(textsFor("pl")).toBe(textTables.pl);
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

  // Every Polish line puts a value after at most one colon; a second label takes a dash or a plain word.
  test("no Polish line holds two colons", () => {
    const lines: { path: string; line: string }[] = [];
    const collect = (path: string, value: unknown): void => {
      if (typeof value === "string") {
        for (const line of value.split("\n")) lines.push({ path, line });
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => collect(`${path}[${index}]`, item));
      } else if (typeof value === "function") {
        for (const args of samples) {
          if (args.length === value.length) collect(path, value(...args));
        }
      } else if (typeof value === "object" && value !== null) {
        for (const [key, child] of Object.entries(value)) collect(`${path}.${key}`, child);
      }
    };
    collect("pl", textTables.pl);
    expect(lines.length).toBeGreaterThan(100);
    for (const { path, line } of lines) {
      const colons = line.match(/:(?=\s|$)/g)?.length ?? 0;
      expect(colons, `${path}: ${line}`).toBeLessThanOrEqual(1);
      // A line with a colon takes no spaced dash: one separator style per line.
      expect(colons > 0 && line.includes(" – "), `${path}: ${line}`).toBe(false);
    }
  });
});
