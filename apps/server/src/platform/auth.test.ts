import { APIError } from "better-auth/api";
import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { AUTH_ALLOWED_PATHS, cleanLogText, createAddressLimiter, isAllowedAuthPath, onAuthError } from "./auth";
import { setLogLevel } from "./log";

// The base class that better-auth's APIError extends (better-call is not a direct dependency).
const BaseAPIError = Object.getPrototypeOf(APIError) as new (status: number) => Error;

describe("isAllowedAuthPath", () => {
  test("the reset request passes only with POST and the resetRequest option", () => {
    expect(isAllowedAuthPath("POST", "/request-password-reset")).toBe(false);
    expect(isAllowedAuthPath("POST", "/request-password-reset", { resetRequest: false })).toBe(false);
    expect(isAllowedAuthPath("POST", "/request-password-reset", { resetRequest: true })).toBe(true);
    expect(isAllowedAuthPath("GET", "/request-password-reset", { resetRequest: true })).toBe(false);
    expect(AUTH_ALLOWED_PATHS.size).toBe(8);
  });

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
    for (const path of ["/sign-up/email", "/update-user", "/sign-in/social", "/ok", "/list-accounts", "/", ""]) {
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

describe("onAuthError", () => {
  afterEach(() => setLogLevel("info"));

  function capture(error: unknown): string[] {
    const spy = spyOn(console, "error").mockImplementation((): void => undefined);
    try {
      onAuthError(error);
      return spy.mock.calls.map((call) => call.join(" "));
    } finally {
      spy.mockRestore();
    }
  }

  test("logs nothing for a 4xx APIError", () => {
    expect(capture(new APIError("UNAUTHORIZED", { message: "Invalid password" }))).toEqual([]);
    expect(capture(new APIError("BAD_REQUEST", { message: "bad" }))).toEqual([]);
  });

  test("logs nothing for a base APIError with a 4xx number", () => {
    expect(capture(new BaseAPIError(400))).toEqual([]);
    expect(capture(new BaseAPIError(415))).toEqual([]);
  });

  test("logs a base APIError with a 500 number", () => {
    expect(capture(new BaseAPIError(500))).toHaveLength(1);
  });

  test("logs a 500 APIError with its name only", () => {
    const lines = capture(new APIError("INTERNAL_SERVER_ERROR", { message: "MARKER-DETAIL" }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("better-auth: APIError");
    expect(lines[0]).not.toContain("MARKER-DETAIL");
  });

  test("logs a non-API error with its name only", () => {
    const lines = capture(new TypeError("MARKER-DETAIL"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("better-auth: TypeError");
    expect(lines[0]).not.toContain("MARKER-DETAIL");
  });
});

describe("createAddressLimiter", () => {
  test("allows max requests per window per key, then again after the window", () => {
    let at = new Date("2026-11-12T10:00:00Z");
    const limiter = createAddressLimiter({ max: 3, windowMs: 3_600_000, now: () => at });
    expect([1, 2, 3].map(() => limiter.take("a"))).toEqual([true, true, true]);
    expect(limiter.take("a")).toBe(false);
    expect(limiter.take("b")).toBe(true);
    at = new Date(at.getTime() + 61 * 60_000);
    expect(limiter.take("a")).toBe(true);
  });

  test("a refused request is not recorded", () => {
    let at = new Date("2026-11-12T10:00:00Z");
    const limiter = createAddressLimiter({ max: 1, windowMs: 1000, now: () => at });
    expect(limiter.take("a")).toBe(true);
    at = new Date(at.getTime() + 500);
    expect(limiter.take("a")).toBe(false);
    at = new Date(at.getTime() + 600);
    expect(limiter.take("a")).toBe(true);
  });

  test("a large map is swept of old keys", () => {
    let at = new Date("2026-11-12T10:00:00Z");
    const limiter = createAddressLimiter({ max: 1, windowMs: 1000, now: () => at });
    for (let i = 0; i < 10_001; i += 1) limiter.take(`k${i}`);
    at = new Date(at.getTime() + 5000);
    expect(limiter.take("fresh")).toBe(true);
    expect(limiter.take("k0")).toBe(true);
  });
});
