import { describe, expect, test } from "bun:test";

import { TWO_FACTOR_ALLOWED_PATHS } from "./auth-two-factor";

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
