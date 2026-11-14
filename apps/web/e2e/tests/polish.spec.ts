import { expect, test, type Page } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
import { cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

// A Polish browser and a user without a stored choice: the panel speaks Polish. The spec changes no data.
test.use({ locale: "pl-PL" });

let errors: string[] = [];

function onMobile(): boolean {
  return test.info().project.name === "mobile";
}

// The two projects run in different worker processes, so each gets its own block of the 198.51.100.0/24 range.
test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(onMobile() ? 20 : 120) });
  errors = await cspErrors(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

test("the login page is Polish and fits the screen", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: pl.login_title })).toBeVisible();
  await expect(page.getByLabel(pl.email_label)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("pl");
  expect(await fitsWidth(page)).toBe(true);
});

test("the other pages before the sign-in are Polish and fit the screen", async ({ page }) => {
  await page.goto("/forgot");
  await expect(page.getByRole("heading", { level: 1, name: pl.forgot_title })).toBeVisible();
  expect(await fitsWidth(page)).toBe(true);

  await page.goto("/setup");
  await expect(page.getByText(pl.setup_link_missing)).toBeVisible();
  expect(await fitsWidth(page)).toBe(true);

  await page.goto("/legal/pl/terms");
  await expect(page.getByRole("heading", { level: 1, name: pl.legal_terms_title })).toBeVisible();
  expect(await fitsWidth(page)).toBe(true);

  await page.goto("/404.html");
  await expect(page.getByText(pl.not_found_text)).toBeVisible();
  await expect(page.getByText(en.not_found_text)).toBeVisible();
  expect(await fitsWidth(page)).toBe(true);
});

const pages = [
  { path: "/activity", title: pl.title_activity },
  { path: "/mailboxes", title: pl.title_mailboxes },
  { path: "/settings", title: pl.title_settings },
  { path: "/rules", title: pl.title_rules },
] as const;

test("the signed-in pages are Polish and fit the screen", async ({ page }) => {
  await signInAs(page, readSeed().owner, pl);
  await expect(page).toHaveURL(/\/onboarding$/);

  for (const { path, title } of pages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(`^${title} · `));
    // The sidebar on a wide screen and the bottom tabs on a phone: one navigation is visible.
    await expect(
      page.getByRole("navigation", { name: pl.nav_main }).getByRole("link", { name: pl.nav_activity })
    ).toBeVisible();
    expect(await fitsWidth(page)).toBe(true);
  }
});

test("the onboarding page stays and is Polish", async ({ page }) => {
  await signInAs(page, readSeed().owner, pl);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { level: 1, name: pl.title_onboarding })).toBeVisible();
  expect(await fitsWidth(page)).toBe(true);
});
