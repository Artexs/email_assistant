import { describe, expect, test } from "bun:test";

import { ApiError } from "./api";
import { deleteError, errorText } from "./errors";

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

describe("deleteError", () => {
  test("the three codes have their text and field", () => {
    expect(deleteError(new ApiError(400, "wrong_password"))).toEqual({ field: "password", key: "del_wrong_password" });
    expect(deleteError(new ApiError(400, "wrong_name"))).toEqual({ field: "name", key: "del_wrong_name" });
    expect(deleteError(new ApiError(429, "locked"))).toEqual({ field: "password", key: "del_locked" });
  });

  test("a busy 503 internal and a closed flag (not_found) prove that nothing was deleted", () => {
    for (const caught of [new ApiError(503, "internal"), new ApiError(404, "not_found")]) {
      expect(deleteError(caught)).toEqual({ field: null, key: "del_failed" });
    }
  });

  test("a network error or an unreadable answer does not say that nothing was deleted", () => {
    for (const caught of [new TypeError("fetch failed"), new SyntaxError("bad json"), "x"]) {
      expect(deleteError(caught)).toEqual({ field: null, key: "del_failed_unknown" });
    }
  });
});
