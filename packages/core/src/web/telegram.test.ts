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
});

describe("telegramConsentBodySchema", () => {
  test("needs a version of 1 to 32 characters", () => {
    expect(telegramConsentBodySchema.safeParse({ version: "2026-11-15.2" }).success).toBe(true);
    expect(telegramConsentBodySchema.safeParse({ version: "" }).success).toBe(false);
    expect(telegramConsentBodySchema.safeParse({ version: "x".repeat(33) }).success).toBe(false);
    expect(telegramConsentBodySchema.safeParse({}).success).toBe(false);
  });
});
