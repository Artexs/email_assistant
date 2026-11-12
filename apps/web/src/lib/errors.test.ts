import { describe, expect, test } from "bun:test";

import { ApiError } from "./api";
import { errorText } from "./errors";

describe("errorText", () => {
  const cases = [
    ["mail_login_failed", "err_mail_login_failed"],
    ["mail_unreachable", "err_mail_unreachable"],
    ["mailbox_exists", "err_mailbox_exists"],
    ["host_not_allowed", "err_host_not_allowed"],
    ["wrong_status", "err_wrong_status"],
    ["owner_only", "owner_only"],
    ["telegram_off", "tg_off"],
    ["telegram_unreachable", "tg_unreachable"],
    ["rule_exists", "err_rule_exists"],
    ["rule_limit", "err_rule_limit"],
    ["not_found", "err_not_found"],
    ["org_suspended", "err_org_suspended"],
    ["mailbox_limit", "err_mailbox_limit"],
  ] as const;

  for (const [code, key] of cases) {
    test(`${code} maps to ${key}`, () => {
      expect(errorText(new ApiError(400, code))).toBe(key);
    });
  }

  test("an unknown code gives error_generic", () => {
    expect(errorText(new ApiError(500, "internal"))).toBe("error_generic");
    expect(errorText(new ApiError(500, "toString"))).toBe("error_generic");
  });

  test("a value that is not an ApiError gives error_generic", () => {
    expect(errorText(new Error("x"))).toBe("error_generic");
  });
});
