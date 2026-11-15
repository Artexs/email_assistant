/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SsoView } from "../components/login/SsoSignIn";
import { setLocaleForTest, t } from "../i18n";
import { ssoFormStart, type SsoFormState } from "./sso-form";

const noop = () => undefined;

function render(state: Partial<SsoFormState>): string {
  return renderToStaticMarkup(
    <SsoView state={{ ...ssoFormStart, ...state }} onOpen={noop} onBack={noop} onEmail={noop} onSubmit={noop} />
  );
}

describe("the open company sign-in form (F119 stage 12)", () => {
  for (const locale of ["en", "pl"] as const) {
    test(`${locale}: e-mail field with label and autocomplete, submit and Back button`, () => {
      setLocaleForTest(locale);
      const html = render({ open: true });
      expect(html).toMatch(/<input[^>]*id="sso-email"[^>]*>/);
      expect(html).toContain('autoComplete="email"');
      expect(html).toMatch(new RegExp(`<label[^>]*for="sso-email"[^>]*>${t("login_sso_email")}</label>`));
      expect(html).toContain(t("login_sso_submit"));
      expect(html).toContain(t("login_sso_back"));
      expect(html).not.toContain('role="alert"');
      expect(html).not.toContain('aria-invalid="true"');
      setLocaleForTest("en");
    });
  }

  test("an error shows in a role=alert paragraph that the field points to", () => {
    setLocaleForTest("pl");
    const html = render({ open: true, error: "login_sso_error_no_provider" });
    expect(html).toMatch(/<p id="sso-error" role="alert"[^>]*>/);
    expect(html).toContain(t("login_sso_error_no_provider"));
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="sso-error"');
    setLocaleForTest("en");
  });

  test("while pending the submit and Back buttons are disabled", () => {
    const html = render({ open: true, pending: true });
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
  });

  test("the closed block has the hint and the button, and no field", () => {
    const html = render({ open: false });
    expect(html).toContain(t("login_sso_button"));
    expect(html).not.toContain("<input");
  });
});
