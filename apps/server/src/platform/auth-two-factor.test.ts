import { describe, expect, test } from "bun:test";

import { SECOND_FACTOR_ACTIONS, secondFactorActionOf, TWO_FACTOR_ALLOWED_PATHS } from "./auth-two-factor";

describe("TWO_FACTOR_ALLOWED_PATHS", () => {
  test("holds the five paths and no path that shows a secret or sends a code", () => {
    expect([...TWO_FACTOR_ALLOWED_PATHS].sort()).toEqual([
      "/two-factor/disable",
      "/two-factor/enable",
      "/two-factor/generate-backup-codes",
      "/two-factor/verify-backup-code",
      "/two-factor/verify-totp",
    ]);
    for (const path of ["/two-factor/get-totp-uri", "/two-factor/send-otp", "/two-factor/verify-otp"]) {
      expect(TWO_FACTOR_ALLOWED_PATHS as readonly string[]).not.toContain(path);
    }
  });
});

describe("SECOND_FACTOR_ACTIONS", () => {
  test("F128: exactly turn off and new codes need a code, and each is an allowed path", () => {
    expect(SECOND_FACTOR_ACTIONS).toEqual({
      "/two-factor/disable": "disable",
      "/two-factor/generate-backup-codes": "backup_codes",
    });
    expect(secondFactorActionOf("/two-factor/disable")).toBe("disable");
    for (const path of ["/two-factor/enable", "/two-factor/verify-totp", "constructor", "toString"]) {
      expect(secondFactorActionOf(path)).toBeNull();
    }
    for (const path of Object.keys(SECOND_FACTOR_ACTIONS)) {
      expect(TWO_FACTOR_ALLOWED_PATHS as readonly string[]).toContain(path);
    }
  });
});
