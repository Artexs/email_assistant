/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import LoginPage from "../islands/LoginPage";
import { setLocaleForTest, t } from "../i18n";
import { SsoSignIn } from "../components/login/SsoSignIn";

describe("company sign-in on the login page (F119 stage 12)", () => {
  test("the first render, before the options are read, has no company sign-in element", () => {
    for (const locale of ["en", "pl"] as const) {
      setLocaleForTest(locale);
      const html = renderToStaticMarkup(<LoginPage />);
      expect(html).toContain('id="password"');
      expect(html).not.toContain('data-block="sso"');
      expect(html).not.toContain(t("login_sso_button"));
      expect(html).not.toContain(t("login_sso_hint"));
    }
    setLocaleForTest("en");
  });

  test("the closed block shows the hint and the button in both languages, and no form field", () => {
    for (const locale of ["en", "pl"] as const) {
      setLocaleForTest(locale);
      const html = renderToStaticMarkup(<SsoSignIn next="/" />);
      expect(html).toContain(t("login_sso_hint"));
      expect(html).toContain(t("login_sso_button"));
      expect(html).not.toContain("<input");
    }
    setLocaleForTest("en");
  });
});
