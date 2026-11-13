import { expect, test } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

// Test 5 needs the dialog, test 3 accepts it: the order matters. The accept test changes only the terms owner of its project.
test.describe.configure({ mode: "serial" });

let errors: string[] = [];

// Blocks: 100 and 200.
test.beforeEach(async ({ context, page }, testInfo) => {
  const base = testInfo.project.name === "mobile" ? 100 : 200;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(base) });
  errors = await cspErrors(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

const project = (name: string) => name as "mobile" | "desktop";

test("the dialog cannot be closed by Escape or a click outside", async ({ page }, testInfo) => {
  await signInAs(page, readSeed().termsOwners[project(testInfo.project.name)]);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(en.terms_dialog_title)).toBeVisible();
  await expect(dialog.getByRole("link", { name: en.legal_terms_title })).toHaveAttribute("rel", "noopener noreferrer");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2);
  await expect(dialog).toBeVisible();
});

test("log out in the dialog leads to the login page", async ({ page }, testInfo) => {
  await signInAs(page, readSeed().termsOwners[project(testInfo.project.name)]);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(en.terms_dialog_title)).toBeVisible();
  await dialog.getByRole("button", { name: en.log_out }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("accepting closes the dialog and it stays closed after a reload", async ({ page }, testInfo) => {
  await signInAs(page, readSeed().termsOwners[project(testInfo.project.name)]);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(en.terms_dialog_title)).toBeVisible();
  await dialog.getByRole("button", { name: en.terms_dialog_accept }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: en.terms_dialog_title })).toHaveCount(0);
  const me = await page.request.get("/api/me");
  expect(me.ok()).toBe(true);
  expect(((await me.json()) as { terms: { accepted: boolean } }).terms.accepted).toBe(true);
});

test("the main owner sees no dialog", async ({ page }) => {
  await signInAs(page, readSeed().owner);
  await expect(page).toHaveURL(/\/(onboarding|activity|mailboxes)/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
