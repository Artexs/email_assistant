/// <reference types="bun" />
import { TELEGRAM_CONSENT_VERSION } from "@ea/core/web";
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { NewTerms } from "../components/telegram/NewTerms";
import { setLocaleForTest, t } from "../i18n";
import { needsNewTerms } from "./telegram-consent";

afterEach(() => setLocaleForTest("en"));

const ON = ["open_loops"];

describe("needsNewTerms (T4)", () => {
  test("a linked user with an older consent, no consent or an invalid one needs the new terms", () => {
    for (const consentVersion of ["2026-11-15", "2026-11-14", "2026-11-15.1", null, "zzz"]) {
      expect({ consentVersion, needs: needsNewTerms({ linked: true, consentVersion }, ON) }).toEqual({
        consentVersion,
        needs: true,
      });
    }
  });

  test("the current version, a later version, an unlinked chat and the flag off need nothing", () => {
    expect(needsNewTerms({ linked: true, consentVersion: TELEGRAM_CONSENT_VERSION }, ON)).toBe(false);
    expect(needsNewTerms({ linked: true, consentVersion: "2099-01-01" }, ON)).toBe(false);
    expect(needsNewTerms({ linked: false, consentVersion: null }, ON)).toBe(false);
    expect(needsNewTerms({ linked: true, consentVersion: null }, [])).toBe(false);
    expect(needsNewTerms({ linked: true, consentVersion: null }, ["delegate_button"])).toBe(false);
  });
});

function render(consentVersion: string | null, features: readonly string[] = ON, busy = false): string {
  return renderToStaticMarkup(
    <NewTerms state={{ linked: true, consentVersion }} features={features} busy={busy} onConfirm={() => undefined} />
  );
}

describe("NewTerms (T4, render)", () => {
  setLocaleForTest("en");

  test("an old version shows the title, the consent text and a Confirm button", () => {
    const html = render("2026-11-15");
    expect(html).toContain("New Telegram terms: open loops");
    expect(html).toContain(t("tg_consent_text").slice(0, 60));
    expect(html).toMatch(/<button[^>]*>Confirm<\/button>/);
  });

  test("the current version shows nothing", () => {
    expect(render(TELEGRAM_CONSENT_VERSION)).toBe("");
  });

  test("the button is disabled while a write runs", () => {
    expect(render("2026-11-15", ON, true)).toMatch(/<button[^>]*disabled=""[^>]*>Confirm<\/button>/);
  });

  test("the Polish block is Polish", () => {
    setLocaleForTest("pl");
    const html = render(null);
    expect(html).toContain("Nowe zasady Telegrama: otwarte sprawy");
    expect(html).toContain(">Potwierdź</button>");
    expect(html).not.toContain("Confirm");
  });
});
