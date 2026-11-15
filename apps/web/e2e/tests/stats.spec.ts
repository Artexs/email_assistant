import { expect, test } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The stats organization has the flag `stats_page` on; the main organization has not (auth.spec counts its 4 phone tabs).
// The spec changes no data. Blocks: 55 and 155.
test("the Stats page loads its table and has no axe violation", async ({ context, page }, testInfo) => {
  const base = testInfo.project.name === "mobile" ? 55 : 155;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(base) });
  const errors = await cspErrors(page);
  await signInAs(page, readSeed().statsOwner);
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.goto("/stats");
  await expect(page.getByRole("heading", { level: 1, name: en.title_stats })).toBeVisible();
  await expect(page.getByText(en.stats_note)).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});
