import { expect, test } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
import { legalDocs, legalLangs, legalPath, type LegalDoc } from "../../src/lib/legal";
import { cspErrors, nextAddress } from "../helpers";

function textsOf(lang: (typeof legalLangs)[number]) {
  return lang === "pl" ? pl : en;
}

function titleOf(lang: (typeof legalLangs)[number], doc: LegalDoc): string {
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

// The two projects run in different worker processes, so each gets its own block of the 198.51.100.0/24 range.
// The blocks differ from the ones of auth.spec.ts and forgot.spec.ts, which run in the same workers.
function addressBase(): number {
  return onMobile() ? 70 : 170;
}

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(addressBase()) });
});

for (const lang of legalLangs) {
  for (const doc of legalDocs) {
    test(`a visitor without a session reads /legal/${lang}/${doc}`, async ({ page }) => {
      const errors = await cspErrors(page);
      const path = legalPath(lang, doc);
      const texts = textsOf(lang);

      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: titleOf(lang, doc) })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.getByText(texts.legal_stub_text)).toBeVisible();
      await expect(page.getByRole("link", { name: texts.go_to_sign_in })).toHaveAttribute("href", "/login");
      expect(errors).toEqual([]);
    });
  }
}
