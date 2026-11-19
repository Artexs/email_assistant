import { describe, expect, test } from "bun:test";

import { isStorableSuggestionPattern, SUGGESTION_PATTERN_MAX_LENGTH } from "./pattern";

describe("isStorableSuggestionPattern", () => {
  test("a plain address and a plain domain pattern are storable", () => {
    expect(isStorableSuggestionPattern("anna@acme.pl")).toBe(true);
    expect(isStorableSuggestionPattern("@acme.pl")).toBe(true);
    expect(isStorableSuggestionPattern("jürgen@acme.pl")).toBe(true);
  });

  test("the length limit is 254 characters, counted in characters", () => {
    const local = "a".repeat(SUGGESTION_PATTERN_MAX_LENGTH - "@acme.pl".length);
    expect(isStorableSuggestionPattern(`${local}@acme.pl`)).toBe(true);
    expect(isStorableSuggestionPattern(`${local}a@acme.pl`)).toBe(false);
    expect(isStorableSuggestionPattern("a")).toBe(false);
    expect(isStorableSuggestionPattern("")).toBe(false);
    // 254 characters that are 2 UTF-16 units each still fit.
    expect(isStorableSuggestionPattern(`${"😀".repeat(SUGGESTION_PATTERN_MAX_LENGTH - 8)}@acme.pl`)).toBe(true);
  });

  test("white space, control characters, `<`, `>` and upper case are refused", () => {
    for (const bad of [
      "spam<x>@acme.pl",
      "a>@acme.pl",
      "a b@acme.pl",
      "a\tb@acme.pl",
      "a\u0001b@acme.pl",
      "a\nb@acme.pl",
      "Anna@acme.pl",
    ]) {
      expect(isStorableSuggestionPattern(bad)).toBe(false);
    }
  });
});
