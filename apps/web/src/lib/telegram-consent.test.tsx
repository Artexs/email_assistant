/// <reference types="bun" />
import { REPLY_CONSENT_SINCE, TELEGRAM_CONSENT_VERSION } from "@ea/core/web";
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

// The flag of each data kind decides which consent text the block asks for: open loops need the current text, reply drafts need the
// text that names reply data. Both flags on: either one is enough.
describe("needsNewTerms for each flag", () => {
  const OLD = "2026-11-15.2";
  const linked = (consentVersion: string | null) => ({ linked: true, consentVersion });

  test("reply_drafts only: an older consent needs the terms, a covering one does not", () => {
    expect(needsNewTerms(linked(OLD), ["reply_drafts"])).toBe(true);
    expect(needsNewTerms(linked(null), ["reply_drafts"])).toBe(true);
    expect(needsNewTerms(linked(REPLY_CONSENT_SINCE), ["reply_drafts"])).toBe(false);
    expect(needsNewTerms({ linked: false, consentVersion: null }, ["reply_drafts"])).toBe(false);
  });

  test("open_loops only: an older consent needs the terms, a covering one does not", () => {
    expect(needsNewTerms(linked(OLD), ["open_loops"])).toBe(true);
    expect(needsNewTerms(linked(TELEGRAM_CONSENT_VERSION), ["open_loops"])).toBe(false);
  });

  test("both flags: one missing coverage is enough; both covered needs nothing", () => {
    expect(needsNewTerms(linked(OLD), ["open_loops", "reply_drafts"])).toBe(true);
    expect(needsNewTerms(linked(TELEGRAM_CONSENT_VERSION), ["open_loops", "reply_drafts"])).toBe(false);
  });

  test("neither flag: no block, whatever the consent", () => {
    expect(needsNewTerms(linked(OLD), [])).toBe(false);
    expect(needsNewTerms(linked(null), ["delegate_button"])).toBe(false);
  });

  test("the block renders for reply_drafts only, with the neutral title", () => {
    const html = renderToStaticMarkup(
      <NewTerms state={linked(OLD)} features={["reply_drafts"]} busy={false} onConfirm={() => undefined} />
    );
    expect(html).toContain("New Telegram terms");
    expect(html).toMatch(/<button[^>]*>Confirm<\/button>/);
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
    expect(html).toContain(">New Telegram terms</h3>");
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
    expect(html).toContain(">Nowe zasady Telegrama</h3>");
    expect(html).toContain(">Potwierdź</button>");
    expect(html).not.toContain("Confirm");
  });
});
