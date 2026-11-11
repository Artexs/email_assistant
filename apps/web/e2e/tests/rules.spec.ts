import { expect, test } from "@playwright/test";

import { en, t } from "../../src/i18n/en";
import { cleanUpOrg, consoleErrors, cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

test.describe.configure({ mode: "serial" });

let errors: string[] = [];
let logged: string[] = [];

// The blocks of S5a (10/110), S5b (40/140) and settings (60/160) are taken. This spec shares 70 and 170 with
// onboarding.spec.ts: no collision, because there is one worker and the counter in helpers.ts runs across all files.
test.beforeEach(async ({ context, page }, testInfo) => {
  const base = testInfo.project.name === "mobile" ? 70 : 170;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(base) });
  errors = await cspErrors(page);
  logged = consoleErrors(page);
  await signInAs(page, readSeed().owner);
  await expect(page).toHaveURL(/\/onboarding$/);
});

test.afterEach(async ({ page }) => {
  await cleanUpOrg(page);
  expect(errors).toEqual([]);
});

test("add, a duplicate, a bad pattern, delete", async ({ page }) => {
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

  await expect(form.getByRole("combobox", { name: en.rules_kind_label })).toHaveText(en.rule_kind_vip);
  await expect(form.getByRole("combobox", { name: en.rules_scope_label })).toHaveText(en.rules_all_mailboxes);
  await form.getByLabel(en.rules_pattern_label, { exact: true }).fill("boss@e2e.test");
  await form.getByRole("button", { name: en.rules_add }).click();
  await expect(page.getByText(en.rule_added_toast)).toBeVisible();
  await expect(vip.getByText("boss@e2e.test", { exact: true })).toBeVisible();
  await expect(vip.getByText(en.rules_all_mailboxes)).toBeVisible();

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

  await vip.getByRole("button", { name: t("rules_delete", { pattern: "boss@e2e.test" }) }).click();
  await expect(page.getByText(en.rule_deleted_toast)).toBeVisible();
  await expect(vip.getByText(en.rules_empty)).toBeVisible();
});
