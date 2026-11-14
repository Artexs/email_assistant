import { describe, expect, test } from "bun:test";

import { holdsToken, secretOfUri, totpCode } from "./totp";

describe("totp helpers", () => {
  test("RFC 6238 vectors", () => {
    expect(totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000)).toBe("287082");
    expect(totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1_111_111_109_000)).toBe("081804");
  });

  test("secretOfUri reads the secret and throws without one", () => {
    expect(secretOfUri("otpauth://totp/A:b?secret=JBSWY3DP&issuer=A")).toBe("JBSWY3DP");
    expect(() => secretOfUri("otpauth://totp/A:b?issuer=A")).toThrow();
  });

  test("holdsToken matches a 6-digit code as a whole token, other values as a substring", () => {
    expect(holdsToken("code 123456 sent", "123456")).toBe(true);
    expect(holdsToken("123456", "123456")).toBe(true);
    expect(holdsToken("ms=1234567", "123456")).toBe(false);
    expect(holdsToken("id 91234560", "123456")).toBe(false);
    expect(holdsToken("x abcde-12345 y", "abcde-12345")).toBe(true);
    expect(holdsToken("xxotpauth://", "otpauth")).toBe(true);
  });
});
