import { expect, test } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The stats organization has the flag `stats_page` on; the main organization has not (auth.spec counts its 4 phone tabs).
// The spec changes no data. It has its own address, not `nextAddress`: a call moves the counter of the worker, and the files that
// run after this one (terms.spec.ts: block 200 plus the count) would pass 255, which is no valid address (see alert-layout.spec.ts).
test("the Stats page loads its table and has no axe violation", async ({ context, page }, testInfo) => {
  const address = testInfo.project.name === "mobile" ? "198.51.100.6" : "198.51.100.7";
  await context.setExtraHTTPHeaders({ "x-forwarded-for": address });
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
