import { describe, expect, test } from "bun:test";

import { pl } from "../i18n/pl";
import { accountTwoFactorError, cleanBackupCode, cleanTotpCode, codeStepError } from "./two-factor-errors";

describe("codeStepError", () => {
  test("maps each error to its key and restart choice", () => {
    expect(codeStepError(null)).toBeNull();
    expect(codeStepError(undefined)).toBeNull();
    expect(codeStepError({ status: 429, code: "ACCOUNT_TEMPORARILY_LOCKED" })).toEqual({
      key: "tf_error_locked",
      restart: true,
    });
    expect(codeStepError({ status: 429 })).toEqual({ key: "error_too_many", restart: false });
    expect(codeStepError({ status: 401, code: "INVALID_CODE" })).toEqual({ key: "tf_error_code", restart: false });
    expect(codeStepError({ status: 401, code: "INVALID_BACKUP_CODE" })).toEqual({
      key: "tf_error_backup_code",
      restart: false,
    });
    expect(codeStepError({ status: 400, code: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE" })).toEqual({
      key: "tf_error_attempts",
      restart: true,
    });
    expect(codeStepError({ status: 401, code: "INVALID_TWO_FACTOR_COOKIE" })).toEqual({
      key: "tf_error_expired",
      restart: true,
    });
    expect(codeStepError({ status: 400, code: "TOTP_NOT_ENABLED" })).toEqual({ key: "tf_error_state", restart: false });
    expect(codeStepError({ status: 400, code: "BACKUP_CODES_NOT_ENABLED" })).toEqual({
      key: "tf_error_state",
      restart: false,
    });
    expect(codeStepError({ status: 500, code: "SOMETHING_ELSE" })).toEqual({ key: "error_generic", restart: false });
    expect(codeStepError({})).toEqual({ key: "error_generic", restart: false });
  });
});

describe("accountTwoFactorError", () => {
  test("maps each error to its field and key", () => {
    expect(accountTwoFactorError(null)).toBeNull();
    expect(accountTwoFactorError(undefined)).toBeNull();
    expect(accountTwoFactorError({ status: 429, code: "INVALID_PASSWORD" })).toEqual({
      field: null,
      key: "error_too_many",
    });
    expect(accountTwoFactorError({ status: 400, code: "INVALID_PASSWORD" })).toEqual({
      field: "password",
      key: "tf_error_password",
    });
    expect(accountTwoFactorError({ status: 401, code: "INVALID_CODE" })).toEqual({
      field: "code",
      key: "tf_error_code",
    });
    expect(accountTwoFactorError({ status: 400, code: "BREAK_GLASS_NEEDS_TWO_FACTOR" })).toEqual({
      field: null,
      key: "tf_error_break_glass",
    });
    for (const code of ["TOTP_ALREADY_ENABLED", "TWO_FACTOR_NOT_ENABLED", "TOTP_NOT_ENABLED"]) {
      expect(accountTwoFactorError({ status: 400, code })).toEqual({ field: null, key: "tf_error_state" });
    }
    expect(accountTwoFactorError({ status: 500, code: "SOMETHING_ELSE" })).toEqual({
      field: null,
      key: "error_generic",
    });
    expect(accountTwoFactorError({})).toEqual({ field: null, key: "error_generic" });
  });
});

describe("cleanTotpCode", () => {
  test("removes spaces and keeps 6 digits", () => {
    expect(cleanTotpCode("123 456")).toBe("123456");
    expect(cleanTotpCode(" 123456 ")).toBe("123456");
    for (const bad of ["12345", "1234567", "12a456", ""]) expect(cleanTotpCode(bad)).toBeNull();
  });
});

describe("cleanBackupCode", () => {
  test("trims, adds the dash and keeps the case", () => {
    expect(cleanBackupCode("AbCdE-12345")).toBe("AbCdE-12345");
    expect(cleanBackupCode(" abcde-12345 ")).toBe("abcde-12345");
    expect(cleanBackupCode("abcde12345")).toBe("abcde-12345");
    for (const bad of ["abcd-12345", "abcde_12345", ""]) expect(cleanBackupCode(bad)).toBeNull();
  });
});

describe("Polish texts of the code step", () => {
  test("pins one fixed Polish value", () => {
    expect(pl.tf_error_expired).toBe("Czas na wpisanie kodu minął. Zaloguj się ponownie.");
  });
});
