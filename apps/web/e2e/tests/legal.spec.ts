import { expect, test } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { legalDocs, legalLangs, legalPath, type LegalDoc } from "../../src/lib/legal";
import { cspErrors, nextAddress } from "../helpers";

const titles: Record<LegalDoc, string> = {
  privacy: en.legal_privacy_title,
  terms: en.legal_terms_title,
  dpa: en.legal_dpa_title,
};

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

      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1, name: titles[doc] })).toBeVisible();
      await expect(page.getByText(en.legal_stub_text)).toBeVisible();
      await expect(page.getByRole("link", { name: en.go_to_sign_in })).toHaveAttribute("href", "/login");
      expect(errors).toEqual([]);
    });
  }
}
