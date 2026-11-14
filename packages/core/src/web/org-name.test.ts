import { describe, expect, test } from "bun:test";

import { orgNameMatches } from "./org-name";

describe("orgNameMatches", () => {
  test("trims both sides and ignores case, also for Polish letters", () => {
    expect(orgNameMatches("Zażółć Sp.", "zażółć sp.")).toBe(true);
    expect(orgNameMatches(" Acme Test ", " acme test ")).toBe(true);
  });

  test("a different or empty text does not match", () => {
    expect(orgNameMatches("Acme", "Acme Ltd")).toBe(false);
    expect(orgNameMatches("Acme", "")).toBe(false);
    expect(orgNameMatches("Acme", "   ")).toBe(false);
    expect(orgNameMatches("", "")).toBe(false);
  });
});
