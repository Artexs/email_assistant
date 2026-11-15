import { describe, expect, test } from "bun:test";

import { consentCovers, telegramConsentBodySchema } from "./telegram";

describe("consentCovers", () => {
  test("T5 is true only for a version that is not older than `since`", () => {
    expect(consentCovers("2026-11-20", "2026-11-20")).toBe(true);
    expect(consentCovers("2026-11-15", "2026-11-20")).toBe(false);
    expect(consentCovers("2026-11-15", "2026-11-15.2")).toBe(false);
    expect(consentCovers("2026-11-16", "2026-11-15.2")).toBe(true);
    expect(consentCovers("2026-11-15.2", "2026-11-15.2")).toBe(true);
    expect(consentCovers("2026-11-15.3", "2026-11-15.2")).toBe(true);
    expect(consentCovers(null, "2026-11-15")).toBe(false);
    expect(consentCovers(null, "2000-01-01")).toBe(false);
  });

  test("N1 a version is a date with a numeric suffix; an invalid version is never covered", () => {
    const since = "2026-11-15.2";
    expect(consentCovers("2026-11-15", since)).toBe(false);
    expect(consentCovers("2026-11-15.1", since)).toBe(false);
    expect(consentCovers("2026-11-15.2", since)).toBe(true);
    expect(consentCovers("2026-11-15.10", since)).toBe(true);
    expect(consentCovers("2026-11-16", since)).toBe(true);
    for (const garbage of ["", "zzzz", "2026-11-15.", "2026-11-15.x", "2099-1-1", " 2026-11-16", "2026-11-16\n"]) {
      expect(consentCovers(garbage, since)).toBe(false);
    }
    expect(consentCovers("2026-11-16", "garbage")).toBe(false);
  });
});

describe("telegramConsentBodySchema", () => {
  test("needs a version of 1 to 32 characters", () => {
    expect(telegramConsentBodySchema.safeParse({ version: "2026-11-15.2" }).success).toBe(true);
    expect(telegramConsentBodySchema.safeParse({ version: "" }).success).toBe(false);
    expect(telegramConsentBodySchema.safeParse({ version: "x".repeat(33) }).success).toBe(false);
    expect(telegramConsentBodySchema.safeParse({}).success).toBe(false);
  });
});
