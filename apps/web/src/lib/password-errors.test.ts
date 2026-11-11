import { describe, expect, test } from "bun:test";

import { changePasswordError } from "./password-errors";

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
