import { describe, expect, test } from "bun:test";

import { orgNameMatches } from "./org-name";

describe("orgNameMatches", () => {
  test("trims both sides and ignores case, also for Polish letters", () => {
    expect(orgNameMatches("Zażółć Sp.", "zażółć sp.")).toBe(true);
    expect(orgNameMatches(" Acme Test ", " acme test ")).toBe(true);
  });

  test("composed and decomposed forms of the same letters match", () => {
    const composed = "Zażółć Sp.";
    const decomposed = composed.normalize("NFD");
    expect(decomposed).not.toBe(composed);
    expect(orgNameMatches(composed, decomposed)).toBe(true);
    expect(orgNameMatches(decomposed, composed)).toBe(true);
    expect(orgNameMatches(decomposed.toUpperCase(), composed)).toBe(true);
  });

  test("a different or empty text does not match", () => {
    expect(orgNameMatches("Acme", "Acme Ltd")).toBe(false);
    expect(orgNameMatches("Acme", "")).toBe(false);
    expect(orgNameMatches("Acme", "   ")).toBe(false);
    expect(orgNameMatches("", "")).toBe(false);
  });
});
