import { expect, test, type Page } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { alertFill, expectAlertFills, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

// F127: an alert with a bare text child must use the full width of its box. The "mobile" (Pixel 7) and "desktop" projects give the two widths.
// The two-factor alerts need an operator, a break-glass owner with the second factor off (the server refuses that) or a user with few
// backup codes. The seed has none of them, so the spec answers the status request of the Account card with each state: the page, the
// component and the styles are the real ones. Blocks 230 and 245 (the other specs use 0..220).

test.beforeEach(async ({ context }, testInfo) => {
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": nextAddress(testInfo.project.name === "mobile" ? 230 : 245),
  });
});

interface Status {
  enabled: boolean;
  backupCodesLeft: number | null;
  requiredBy: ("operator" | "break_glass")[];
}

async function openAccountCard(page: Page, projectName: string, status: Status) {
  const user = readSeed().twoFactorOwners[projectName as "mobile" | "desktop"];
  await signInAs(page, user);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.route("**/api/me/two-factor", (route) => route.fulfill({ json: status }));
  await page.goto("/settings");
  return page.locator("[data-section=two-factor]");
}

test("the login 'setup done' alert fills its box", async ({ page }) => {
  await page.goto("/login?setup=done");
  const alert = page.getByRole("alert").filter({ hasText: en.login_setup_done });
  await expect(alert).toBeVisible();
  expectAlertFills(await alertFill(alert), "login setup done");
});

test("the 'two-factor required' alert of an operator fills its box", async ({ page }, testInfo) => {
  const section = await openAccountCard(page, testInfo.project.name, {
    enabled: false,
    backupCodesLeft: null,
    requiredBy: ["operator"],
  });
  const alert = section.getByRole("alert").filter({ hasText: en.tf_required_operator });
  await expect(alert).toBeVisible();
  expectAlertFills(await alertFill(alert), "two-factor required (operator)");
});

test("the 'two-factor required' alert of a break-glass owner fills its box", async ({ page }, testInfo) => {
  const section = await openAccountCard(page, testInfo.project.name, {
    enabled: false,
    backupCodesLeft: null,
    requiredBy: ["break_glass"],
  });
  const alert = section.getByRole("alert").filter({ hasText: en.tf_required_break_glass });
  await expect(alert).toBeVisible();
  expectAlertFills(await alertFill(alert), "two-factor required (break-glass)");
});

test("the 'few backup codes' alert fills its box", async ({ page }, testInfo) => {
  const section = await openAccountCard(page, testInfo.project.name, {
    enabled: true,
    backupCodesLeft: 2,
    requiredBy: [],
  });
  const alert = section.getByRole("alert").filter({ hasText: en.tf_codes_few });
  await expect(alert).toBeVisible();
  expectAlertFills(await alertFill(alert), "few backup codes");
});
