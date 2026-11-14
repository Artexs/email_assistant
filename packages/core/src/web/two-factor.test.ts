import { describe, expect, test } from "bun:test";

import { twoFactorStatusSchema } from "./two-factor";

describe("twoFactorStatusSchema", () => {
  test("accepts an enrolled and a not enrolled state", () => {
    expect(
      twoFactorStatusSchema.safeParse({ enabled: true, backupCodesLeft: 7, requiredBy: ["operator"] }).success
    ).toBe(true);
    expect(twoFactorStatusSchema.safeParse({ enabled: false, backupCodesLeft: null, requiredBy: [] }).success).toBe(
      true
    );
  });

  test("refuses an extra key, a negative count and an unknown requirement", () => {
    const base = { enabled: true, backupCodesLeft: 7, requiredBy: [] };
    expect(twoFactorStatusSchema.safeParse({ ...base, backupCodes: ["x"] }).success).toBe(false);
    expect(twoFactorStatusSchema.safeParse({ ...base, backupCodesLeft: -1 }).success).toBe(false);
    expect(twoFactorStatusSchema.safeParse({ ...base, requiredBy: ["admin"] }).success).toBe(false);
  });
});
