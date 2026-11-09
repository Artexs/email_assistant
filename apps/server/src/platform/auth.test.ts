import { describe, expect, test } from "bun:test";

import { AUTH_ALLOWED_PATHS, cleanLogText, isAllowedAuthPath } from "./auth";

describe("isAllowedAuthPath", () => {
  test("allows the eight paths with POST and GET", () => {
    expect(AUTH_ALLOWED_PATHS.size).toBe(8);
    for (const path of AUTH_ALLOWED_PATHS) {
      expect(isAllowedAuthPath("POST", path)).toBe(true);
      expect(isAllowedAuthPath("GET", path)).toBe(true);
    }
  });

  test("allows the reset link only with GET", () => {
    expect(isAllowedAuthPath("GET", "/reset-password/abc")).toBe(true);
    expect(isAllowedAuthPath("POST", "/reset-password/abc")).toBe(false);
  });

  test("refuses every other path", () => {
    for (const path of [
      "/request-password-reset",
      "/sign-up/email",
      "/update-user",
      "/sign-in/social",
      "/ok",
      "/list-accounts",
      "/",
      "",
    ]) {
      expect(isAllowedAuthPath("POST", path)).toBe(false);
      expect(isAllowedAuthPath("GET", path)).toBe(false);
    }
  });
});

describe("cleanLogText", () => {
  test("replaces a URL", () => {
    expect(cleanLogText("Invalid callbackURL: https://evil.test/a?b=c")).toBe("Invalid callbackURL: <url>");
  });

  test("replaces control characters with spaces", () => {
    expect(cleanLogText("a\nb\tc")).toBe("a b c");
  });

  test("cuts the text to 200 characters", () => {
    expect(cleanLogText("x".repeat(300))).toHaveLength(200);
  });

  test("keeps a plain text", () => {
    expect(cleanLogText("Invalid password")).toBe("Invalid password");
  });
});
