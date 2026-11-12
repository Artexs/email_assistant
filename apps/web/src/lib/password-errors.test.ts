import { describe, expect, test } from "bun:test";

import { changePasswordError, setupError, signOutAllResult } from "./password-errors";

describe("changePasswordError", () => {
  test("no error gives null", () => {
    expect(changePasswordError(null)).toBeNull();
    expect(changePasswordError(undefined)).toBeNull();
  });

  test("INVALID_PASSWORD is the current-password field, also with status 400", () => {
    const expected = { field: "current", key: "acct_wrong_current" } as const;
    expect(changePasswordError({ code: "INVALID_PASSWORD" })).toEqual(expected);
    expect(changePasswordError({ status: 400, code: "INVALID_PASSWORD" })).toEqual(expected);
  });

  test("PASSWORD_TOO_SHORT and PASSWORD_TOO_LONG are the new-password field", () => {
    expect(changePasswordError({ status: 400, code: "PASSWORD_TOO_SHORT" })).toEqual({
      field: "password",
      key: "password_too_short",
    });
    expect(changePasswordError({ status: 400, code: "PASSWORD_TOO_LONG" })).toEqual({
      field: "password",
      key: "password_too_long",
    });
  });

  test("PASSWORD_COMPROMISED is the new-password field", () => {
    expect(changePasswordError({ status: 400, code: "PASSWORD_COMPROMISED" })).toEqual({
      field: "password",
      key: "password_pwned",
    });
  });

  test("503 and PASSWORD_CHECK_UNAVAILABLE are a form error", () => {
    const expected = { field: null, key: "password_check_unavailable" } as const;
    expect(changePasswordError({ status: 503, code: "PASSWORD_CHECK_UNAVAILABLE" })).toEqual(expected);
    expect(changePasswordError({ status: 503 })).toEqual(expected);
    expect(changePasswordError({ code: "PASSWORD_CHECK_UNAVAILABLE" })).toEqual(expected);
  });

  test("429 is too many attempts, also with a code", () => {
    expect(changePasswordError({ status: 429 })).toEqual({ field: null, key: "error_too_many" });
    expect(changePasswordError({ status: 429, code: "INVALID_PASSWORD" })).toEqual({
      field: null,
      key: "error_too_many",
    });
  });

  test("any other error is generic", () => {
    expect(changePasswordError({ status: 500 })).toEqual({ field: null, key: "error_generic" });
    expect(changePasswordError({ status: 400, code: "SOMETHING_ELSE" })).toEqual({
      field: null,
      key: "error_generic",
    });
    expect(changePasswordError({})).toEqual({ field: null, key: "error_generic" });
  });
});

describe("signOutAllResult", () => {
  test("no error and 401 mean done", () => {
    expect(signOutAllResult(null)).toEqual({ done: true });
    expect(signOutAllResult(undefined)).toEqual({ done: true });
    expect(signOutAllResult({ status: 401 })).toEqual({ done: true });
  });

  test("429 and other errors stay on the page with a text", () => {
    expect(signOutAllResult({ status: 429 })).toEqual({ done: false, key: "error_too_many" });
    expect(signOutAllResult({ status: 500 })).toEqual({ done: false, key: "error_generic" });
    expect(signOutAllResult({})).toEqual({ done: false, key: "error_generic" });
  });
});

describe("setupError", () => {
  test("INVALID_TOKEN means the link is dead", () => {
    expect(setupError(400, "INVALID_TOKEN")).toBe("invalid");
  });

  test("429 is too many attempts, also with a code", () => {
    expect(setupError(429, null)).toBe("error_too_many");
    expect(setupError(429, "TERMS_REQUIRED")).toBe("error_too_many");
  });

  test("TERMS_REQUIRED, PASSWORD_COMPROMISED and the check outage have their texts", () => {
    expect(setupError(400, "TERMS_REQUIRED")).toBe("terms_required");
    expect(setupError(400, "PASSWORD_COMPROMISED")).toBe("password_pwned");
    expect(setupError(503, "PASSWORD_CHECK_UNAVAILABLE")).toBe("password_check_unavailable");
    expect(setupError(503, null)).toBe("password_check_unavailable");
    expect(setupError(400, "PASSWORD_CHECK_UNAVAILABLE")).toBe("password_check_unavailable");
  });

  test("any other error is generic", () => {
    expect(setupError(500, null)).toBe("error_generic");
    expect(setupError(400, "SOMETHING_ELSE")).toBe("error_generic");
  });
});
