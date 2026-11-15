import { safeNextPath } from "@ea/core/web";
import { describe, expect, test } from "bun:test";

import { en, type TextKey } from "../i18n/en";
import { pl } from "../i18n/pl";
import { ssoErrorText, ssoReturnError, ssoStartErrorText } from "./sso-errors";

const SSO_KEYS: TextKey[] = [
  "login_sso_hint",
  "login_sso_button",
  "login_sso_email",
  "login_sso_submit",
  "login_sso_back",
  "login_sso_error_no_provider",
  "login_sso_error_rate",
  "login_sso_error_not_member",
  "login_sso_error_domain",
  "login_sso_error_identity",
  "login_sso_error_off",
  "login_sso_error_generic",
];

describe("ssoErrorText", () => {
  test("the four codes with a text map to their keys", () => {
    expect(ssoErrorText("not_a_member")).toBe("login_sso_error_not_member");
    expect(ssoErrorText("domain_mismatch")).toBe("login_sso_error_domain");
    expect(ssoErrorText("identity_mismatch")).toBe("login_sso_error_identity");
    expect(ssoErrorText("sso_off")).toBe("login_sso_error_off");
  });

  test("every other value is the generic text", () => {
    for (const code of [
      "<script>",
      "",
      undefined,
      null,
      "email_unverified",
      "no_provider",
      "NOT_A_MEMBER",
      "constructor",
      "__proto__",
      "toString",
    ]) {
      expect([code, ssoErrorText(code)]).toEqual([code, "login_sso_error_generic"]);
    }
  });
});

describe("ssoReturnError", () => {
  test("a return from the callback maps the code; the description and other keys are ignored", () => {
    expect(ssoReturnError("?sso=failed&error=not_a_member")).toBe("login_sso_error_not_member");
    expect(ssoReturnError("?error=sso_off")).toBe("login_sso_error_off");
    expect(ssoReturnError("?sso=failed&error=sso_off&error_description=<b>x</b>")).toBe("login_sso_error_off");
  });

  test("an unknown code or the marker alone is generic; an address with neither key shows nothing", () => {
    expect(ssoReturnError("?sso=failed&error=<script>alert(1)</script>")).toBe("login_sso_error_generic");
    expect(ssoReturnError("?sso=failed")).toBe("login_sso_error_generic");
    expect(ssoReturnError("?error_description=x")).toBeNull();
    expect(ssoReturnError("")).toBeNull();
    expect(ssoReturnError("?next=%2Factivity&setup=done")).toBeNull();
  });

  test("the result is always a key of the text table, never the raw value", () => {
    const key = ssoReturnError("?sso=failed&error=Ala%20ma%20kota");
    expect(key).not.toBeNull();
    expect(Object.hasOwn(en, key ?? "")).toBe(true);
  });
});

describe("ssoStartErrorText", () => {
  test("429 is the rate text; a missing provider or an unproved domain is the no-provider text", () => {
    expect(ssoStartErrorText(429)).toBe("login_sso_error_rate");
    for (const status of [400, 401, 403, 404]) expect(ssoStartErrorText(status)).toBe("login_sso_error_no_provider");
  });

  test("a server failure is the generic text", () => {
    for (const status of [500, 502, 503]) expect(ssoStartErrorText(status)).toBe("login_sso_error_generic");
  });
});

describe("the safe next path of the company sign-in", () => {
  test("a same-origin path stays; another origin and a protocol-relative address become /", () => {
    expect(safeNextPath("/activity")).toBe("/activity");
    expect(safeNextPath("//evil.test")).toBe("/");
    expect(safeNextPath("https://evil.test")).toBe("/");
  });
});

describe("company sign-in texts", () => {
  test("every key exists in en and pl; pl is not the English text; no colon pair in one line", () => {
    for (const key of SSO_KEYS) {
      expect(en[key].trim(), key).not.toBe("");
      expect(pl[key].trim(), key).not.toBe("");
      expect(pl[key], key).not.toBe(en[key]);
      expect((pl[key].match(/:/g) ?? []).length, key).toBeLessThanOrEqual(1);
    }
  });

  test("every text the mappers return is in the table", () => {
    const returned = [
      ssoErrorText("x"),
      ssoErrorText("not_a_member"),
      ssoErrorText("domain_mismatch"),
      ssoErrorText("identity_mismatch"),
      ssoErrorText("sso_off"),
      ssoStartErrorText(429),
      ssoStartErrorText(404),
      ssoStartErrorText(500),
    ];
    for (const key of returned) expect(SSO_KEYS).toContain(key);
  });
});
