import { TERMS_VERSION, userLocales, type UserLocale } from "@ea/core/web";
import { expect, test } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
import { legalDocs, legalPath, type LegalDoc } from "../../src/lib/legal";
import { findPlaceholders, readLegalSource } from "../../src/lib/legal-checks";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, nextAddress } from "../helpers";

function textsOf(lang: UserLocale) {
  return lang === "pl" ? pl : en;
}

function titleOf(lang: UserLocale, doc: LegalDoc): string {
  const texts = textsOf(lang);
  const titles: Record<LegalDoc, string> = {
    privacy: texts.legal_privacy_title,
    terms: texts.legal_terms_title,
    dpa: texts.legal_dpa_title,
  };
  return titles[doc];
}

function onMobile(): boolean {
  return test.info().project.name === "mobile";
}

// The two projects run in different worker processes, so each gets its own block of the `nextAddress` range (see helpers.ts).
// The blocks differ from the ones of auth.spec.ts and forgot.spec.ts, which run in the same workers.
function addressBase(): number {
  return onMobile() ? 70 : 170;
}

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(addressBase()) });
});

for (const lang of userLocales) {
  for (const doc of legalDocs) {
    test(`a visitor without a session reads /legal/${lang}/${doc}`, async ({ page }) => {
      const errors = await cspErrors(page);
      const path = legalPath(lang, doc);
      const texts = textsOf(lang);

      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: titleOf(lang, doc) })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.getByRole("note")).toHaveText(texts.legal_draft_line);
      await expect(page.getByText(texts.legal_version.replace("{version}", TERMS_VERSION))).toBeVisible();
      await expect(page.getByRole("link", { name: texts.go_to_sign_in })).toHaveAttribute("href", "/login");
      await expect(page.getByRole("link", { name: en.brand })).toHaveAttribute("href", "/login");
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      expect(errors).toEqual([]);
      await expectNoA11yViolations(page);
    });

    test(`every placeholder of the source of /legal/${lang}/${doc} shows as text`, async ({ page }) => {
      await page.goto(legalPath(lang, doc));
      await expect(page.locator(".legal-body")).toBeVisible();
      const placeholders = findPlaceholders(readLegalSource(lang, doc));
      expect(placeholders.length).toBeGreaterThan(0);
      for (const placeholder of placeholders) await expect(page.locator(".legal-body")).toContainText(placeholder);
      // A placeholder that Markdown read as a tag would become an element with this name.
      await expect(page.locator("provider, to, contact, address")).toHaveCount(0);
    });
  }
}

test("the draft line is the first element after the title and the version line follows", async ({ page }) => {
  await page.goto(legalPath("en", "privacy"));
  await expect(page.locator('h1 + p[data-legal="draft"] + p[data-legal="version"]')).toHaveCount(1);
});

test("the privacy page and the DPA list OpenAI in a table; the terms have no sub-processor table", async ({ page }) => {
  await page.goto(legalPath("en", "privacy"));
  await expect(page.getByRole("row", { name: /OpenAI/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: en.legal_categories_title })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: en.legal_subprocessors_none_title })).toBeVisible();

  await page.goto(legalPath("pl", "dpa"));
  await expect(page.getByRole("row", { name: /OpenAI/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: pl.legal_annex2_title })).toBeVisible();

  await page.goto(legalPath("en", "terms"));
  await expect(page.getByRole("heading", { level: 1, name: en.legal_terms_title })).toBeVisible();
  await expect(page.locator("table")).toHaveCount(0);
});

test("the privacy page does not scroll sideways at 320 px; a wide table scrolls inside its own region", async ({
  page,
}) => {
  test.skip(!onMobile(), "the width check runs once, on the phone project");
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(legalPath("en", "privacy"));
  await expect(page.locator(".legal-table").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("the sign-in page links the three documents in the browser language", async ({ page }) => {
  await page.goto("/login");
  const links = page.getByRole("navigation", { name: en.docs_links_label }).getByRole("link");
  await expect(links).toHaveText([en.legal_terms_title, en.legal_privacy_title, en.legal_dpa_title]);
  expect(await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("target")))).toEqual([
    null,
    null,
    null,
  ]);
  expect(await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")))).toEqual([
    "/legal/en/terms",
    "/legal/en/privacy",
    "/legal/en/dpa",
  ]);
});
