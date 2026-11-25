import { expect, test, type Page } from "@playwright/test";

import { E2E_BASE_URL } from "../env";
import { en } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
import { t } from "../../src/i18n";
import { expectNoA11yViolations } from "../a11y";
import { cleanUpOrg, consoleErrors, cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

test.describe.configure({ mode: "serial" });

let errors: string[] = [];
let logged: string[] = [];

// The blocks 10/110, 40/140 and 60/160 are taken. This spec shares 70 and 170 with
// onboarding.spec.ts: no collision, because there is one worker and the counter in helpers.ts runs across all files.
test.beforeEach(async ({ context, page, locale }, testInfo) => {
  const base = testInfo.project.name === "mobile" ? 70 : 170;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(base) });
  errors = await cspErrors(page);
  logged = consoleErrors(page);
  // The sign-in page speaks the language of the browser.
  await signInAs(page, readSeed().owner, locale?.startsWith("pl") ? pl : en);
  await expect(page).toHaveURL(/\/onboarding$/);
});

test.afterEach(async ({ page }) => {
  await cleanUpOrg(page);
  expect(errors).toEqual([]);
});

// The rule exists before the page opens: the add form is covered by rules-form.spec.ts.
async function createBossRule(page: Page): Promise<void> {
  const created = await page.request.post("/api/rules", {
    headers: { origin: E2E_BASE_URL },
    data: { kind: "vip", pattern: "boss@e2e.test" },
  });
  expect(created.status()).toBe(201);
}

test("a rule shows in its list, delete", async ({ page }) => {
  await createBossRule(page);
  logged.length = 0;
  await page.goto("/rules");
  const vip = page.locator("[data-kind=vip]");
  await expect(vip.getByText("boss@e2e.test", { exact: true })).toBeVisible();
  await expect(vip.getByText(en.rules_all_mailboxes)).toBeVisible();
  expect(logged).toEqual([]);
  await expectNoA11yViolations(page);

  await vip.getByRole("button", { name: t("rules_delete", { pattern: "boss@e2e.test" }) }).click();
  await expect(page.getByText(en.rule_deleted_toast)).toBeVisible();
  await expect(vip.getByText(en.rules_empty)).toBeVisible();
});

for (const [language, locale] of [
  ["English", "en-US"],
  ["Polish", "pl-PL"],
] as const) {
  test.describe(`at 320 px, ${language}`, () => {
    test.use({ locale });

    test("the page fits the screen", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "a phone check");
      await createBossRule(page);
      await page.setViewportSize({ width: 320, height: 700 });
      await page.goto("/rules");
      await expect(page.locator("[data-kind=vip]").getByText("boss@e2e.test", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}
