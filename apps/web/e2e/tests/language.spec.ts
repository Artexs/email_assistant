import { expect, test } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
import { cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

test.describe.configure({ mode: "serial" });

let errors: string[] = [];

// The language spec writes `users.locale` of the project's assistant (the account spec changes the password of the member) and sets it back to en after each test. Blocks: 30 and 130.
test.beforeEach(async ({ context, page }, testInfo) => {
  const onMobile = testInfo.project.name === "mobile";
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(onMobile ? 30 : 130) });
  errors = await cspErrors(page);
  await signInAs(page, readSeed().assistants[testInfo.project.name as "mobile" | "desktop"]);
  await expect(page).toHaveURL(/\/onboarding$/);
});

test.afterEach(async ({ page }) => {
  // An English browser shows English for en and for null alike.
  await page.request.patch("/api/me/locale", { data: { locale: "en" } });
  expect(errors).toEqual([]);
});

test("the Account choice switches the panel at once, keeps typed text and survives a reload", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText(en.acct_title, { exact: true })).toBeVisible();
  const field = page.getByLabel(en.acct_current_label);
  await field.fill("marker-f098");

  await page.getByRole("combobox", { name: en.acct_language_label }).click();
  await page.getByRole("option", { name: pl.acct_language_pl }).click();
  await expect(page.getByText(pl.acct_title, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: pl.title_settings })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "pl");
  await expect(page.getByLabel(pl.acct_current_label)).toHaveValue("marker-f098");

  await page.reload();
  await expect(page.getByRole("heading", { name: pl.title_settings })).toBeVisible();

  await page.getByRole("combobox", { name: pl.acct_language_label }).click();
  await page.getByRole("option", { name: en.acct_language_en }).click();
  await expect(page.getByRole("heading", { name: en.title_settings })).toBeVisible();
});
