import { expect, test, type Page } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { cspErrors, nextAddress } from "../helpers";

function onMobile(): boolean {
  return test.info().project.name === "mobile";
}

// The two projects run in different worker processes, so each gets its own block of the 198.51.100.0/24 range.
// The blocks differ from the ones of auth.spec.ts, which runs in the same workers.
function addressBase(): number {
  return onMobile() ? 40 : 140;
}

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(addressBase()) });
});

// The form is in the server HTML, so a click before hydration would post it natively: wait until the island has mounted.
async function openForgot(page: Page): Promise<void> {
  await page.goto("/forgot");
  await expect(page.getByRole("heading", { level: 1, name: en.forgot_title })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

test("a visitor without a session sees the forgot page", async ({ page }) => {
  await openForgot(page);
  await expect(page).toHaveURL(/\/forgot$/);
  await expect(page.getByLabel(en.email_label)).toBeVisible();
});

test("the e2e server has no sender, so the page says reset by e-mail is off", async ({ page }) => {
  await openForgot(page);
  await page.getByLabel(en.email_label).fill("nobody@x.test");
  await page.getByRole("button", { name: en.forgot_send }).click();

  await expect(page.getByRole("alert")).toHaveText(en.forgot_off);
  await expect(page.getByRole("link", { name: en.go_to_sign_in })).toHaveAttribute("href", "/login");
});

test("a wrong address shows the field error and sends no request", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("request-password-reset")) requests.push(request.url());
  });
  await openForgot(page);
  await page.getByLabel(en.email_label).fill("nope");
  await page.getByRole("button", { name: en.forgot_send }).click();

  await expect(page.getByText(en.email_invalid)).toBeVisible();
  expect(requests).toEqual([]);
});

test("the login page links to the forgot page", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: en.login_forgot_link }).click();
  await expect(page).toHaveURL(/\/forgot$/);
  await expect(page.getByRole("heading", { level: 1, name: en.forgot_title })).toBeVisible();
});

test("the forgot page keeps the CSP", async ({ page }) => {
  const errors = await cspErrors(page);
  await openForgot(page);
  await page.getByLabel(en.email_label).fill("nobody@x.test");
  await page.getByRole("button", { name: en.forgot_send }).click();
  await expect(page.getByRole("alert")).toHaveText(en.forgot_off);
  expect(errors).toEqual([]);
});
