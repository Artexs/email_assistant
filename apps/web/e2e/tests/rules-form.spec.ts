import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { en } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
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

test("add, a duplicate, a bad pattern", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/rules") posts.push(request.url());
  });
  logged.length = 0;
  await page.goto("/rules");
  const form = page.locator("[data-card=add-rule]");
  await expect(form).toBeVisible();
  const vip = page.locator("[data-kind=vip]");
  await expect(vip.getByText(en.rules_empty)).toBeVisible();
  expect(logged).toEqual([]);
  await expectNoA11yViolations(page);

  await expect(form.getByRole("combobox", { name: en.rules_kind_label })).toHaveText(en.rules_sentence_kind_vip);
  await expect(form.getByRole("combobox", { name: en.rules_scope_label })).toHaveText(en.rules_sentence_scope_all);
  await form.getByLabel(en.rules_pattern_label, { exact: true }).fill("boss@e2e.test");
  await form.getByRole("button", { name: en.rules_add }).click();
  await expect(page.getByText(en.rule_added_toast)).toBeVisible();
  await expect(vip.getByText("boss@e2e.test", { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);

  // The same rule again: the server answers 409 and the form shows it inline.
  await form.getByLabel(en.rules_pattern_label, { exact: true }).fill("boss@e2e.test");
  await form.getByRole("button", { name: en.rules_add }).click();
  await expect(form.getByRole("alert")).toHaveText(en.err_rule_exists);
  expect(posts).toHaveLength(2);

  // A bad pattern: inline error, no request.
  await form.getByLabel(en.rules_pattern_label, { exact: true }).fill("@x.pl");
  await form.getByRole("button", { name: en.rules_add }).click();
  await expect(form.getByRole("alert")).toHaveText(en.pattern_invalid);
  expect(posts).toHaveLength(2);
});

test.describe("in Polish", () => {
  test.use({ locale: "pl-PL" });

  test("add a VIP rule", async ({ page }) => {
    const pattern = `pl-${randomUUID().slice(0, 8)}@example.com`;
    await page.goto("/rules");
    const form = page.locator("[data-card=add-rule]");
    await expect(form).toBeVisible();
    await expect(form.getByRole("combobox", { name: pl.rules_kind_label })).toHaveText(pl.rules_sentence_kind_vip);
    await expect(form.getByRole("combobox", { name: pl.rules_scope_label })).toHaveText(pl.rules_sentence_scope_all);
    await form.getByLabel(pl.rules_pattern_label, { exact: true }).fill(pattern);
    await form.getByRole("button", { name: pl.rules_add }).click();
    await expect(page.getByText(pl.rule_added_toast)).toBeVisible();
    await expect(page.locator("[data-kind=vip]").getByText(pattern, { exact: true })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});

for (const [language, locale] of [
  ["English", "en-US"],
  ["Polish", "pl-PL"],
] as const) {
  test.describe(`at 320 px, ${language}`, () => {
    test.use({ locale });

    test("the sentence fits the screen", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "a phone check");
      const width = 320;
      await page.setViewportSize({ width, height: 700 });
      await page.goto("/rules");
      await expect(page.locator("[data-card=add-rule]")).toBeVisible();
      // A phone widens its layout viewport to the content, so `innerWidth` would follow an overflow: compare with the set width.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  });
}
