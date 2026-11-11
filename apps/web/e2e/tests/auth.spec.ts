import { expect, test, type Page } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { E2E_BASE_URL } from "../env";
import { cspErrors, nextAddress, signIn } from "../helpers";
import { readSeed } from "../seed";

// Test 4 consumes the one setup link of the project, so the tests of a project run in order.
test.describe.configure({ mode: "serial" });

function onMobile(): boolean {
  return test.info().project.name === "mobile";
}

// Every test gets a fresh context and its own client address: the login rate limit (3 per 10 s per address) never crosses tests.
// The two projects run in different worker processes, so each gets its own block of the 198.51.100.0/24 range.
function addressBase(): number {
  return onMobile() ? 10 : 110;
}

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(addressBase()) });
});

// The phone shows the e-mail in the menu sheet, the desktop in the user menu button (stage 10).
async function expectShellEmail(page: Page, email: string): Promise<void> {
  if (onMobile()) {
    await page.getByRole("button", { name: en.menu_open }).click();
    await expect(page.getByRole("dialog")).toContainText(email);
    return;
  }
  await expect(page.getByRole("button", { name: en.user_menu })).toContainText(email);
}

test("a wrong password is refused", async ({ page }) => {
  const { owner } = readSeed();
  await signIn(page, owner.email, "wrong-password-xx");

  await expect(page.getByRole("alert")).toHaveText(en.login_error_credentials);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel(en.password_label, { exact: true })).toHaveValue("");
  await expect(page.getByLabel(en.email_label)).toHaveValue(owner.email);
});

test("a login opens the shell", async ({ page }) => {
  const { owner } = readSeed();
  await signIn(page, owner.email, owner.password);

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { level: 1, name: en.title_onboarding })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: en.ob_mailbox_title })).toBeVisible();
  // W20 case 6: the seeded organization has no mailbox, so there is no banner.
  await expect(page.getByRole("status")).toHaveCount(0);

  const nav = page.getByRole("navigation", { name: en.nav_main });
  if (onMobile()) {
    await expect(nav.getByRole("link")).toHaveCount(4);
    // Onboarding is the page: none of the four tabs is current.
    await expect(nav.getByRole("link", { name: en.nav_activity })).not.toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: en.menu_open }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText(en.nav_onboarding);
    await expect(sheet).toContainText(owner.email);
    return;
  }
  await expect(nav.getByRole("link").first()).toHaveText(en.nav_onboarding);
  await expect(page.getByRole("button", { name: en.user_menu })).toContainText(owner.email);
  await page.getByRole("button", { name: en.user_menu }).click();
  await expect(page.getByRole("menuitem", { name: en.log_out })).toBeVisible();
});

test("a sign-out closes the session", async ({ page }) => {
  const { owner } = readSeed();
  await signIn(page, owner.email, owner.password);
  await expect(page).toHaveURL(/\/onboarding$/);

  if (onMobile()) {
    await page.getByRole("button", { name: en.menu_open }).click();
    await page.getByRole("dialog").getByRole("button", { name: en.log_out }).click();
  } else {
    await page.getByRole("button", { name: en.user_menu }).click();
    await page.getByRole("menuitem", { name: en.log_out }).click();
  }
  await expect(page).toHaveURL(/\/login$/);

  // The gate: a page path redirects with the target, an API path answers 401 JSON.
  await page.goto("/activity");
  await expect(page).toHaveURL(/\/login\?next=%2Factivity$/);
  const response = await page.request.get("/api/me");
  expect(response.status()).toBe(401);
});

test("the setup link works once", async ({ page }) => {
  const seed = readSeed();
  const assistant = onMobile() ? seed.assistants.mobile : seed.assistants.desktop;

  await page.goto(assistant.setupUrl);
  await expect(page).toHaveURL(/\/setup\?token=/);

  const email = page.getByLabel(en.email_label);
  const password = page.getByLabel(en.new_password_label, { exact: true });
  const repeat = page.getByLabel(en.repeat_password_label, { exact: true });
  await email.fill(assistant.email);

  // The errors are read by id: `password_too_short` is also a substring of the helper text.
  await password.fill("abc");
  await page.getByRole("button", { name: en.set_password }).click();
  await expect(page.locator("#password-error")).toHaveText(en.password_too_short);

  await password.fill("a-good-passphrase-for-e2e");
  await repeat.fill("a-different-passphrase-xx");
  await page.getByRole("button", { name: en.set_password }).click();
  await expect(page.locator("#repeat-error")).toHaveText(en.passwords_differ);

  await repeat.fill("a-good-passphrase-for-e2e");
  await page.getByRole("button", { name: en.set_password }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expectShellEmail(page, assistant.email);

  // The token is used: the same link is an error, and a page without a token says so.
  await page.goto(assistant.setupUrl);
  await expect(page.getByRole("alert")).toHaveText(en.setup_link_invalid);
  await expect(page.getByRole("link", { name: en.go_to_sign_in })).toBeVisible();
  await page.goto("/setup");
  await expect(page.getByRole("alert")).toHaveText(en.setup_link_missing);
});

test("the pages keep the CSP and show the 404 page", async ({ page }) => {
  const { owner } = readSeed();
  const errors = await cspErrors(page);

  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: en.login_title })).toBeVisible();
  await signIn(page, owner.email, owner.password);
  await expect(page).toHaveURL(/\/onboarding$/);

  // A Radix overlay injects a scroll-lock style: the interesting case for `style-src` (fact 13).
  await expectShellEmail(page, owner.email);
  if (!onMobile()) {
    await page.getByRole("button", { name: en.user_menu }).click();
    await expect(page.getByRole("menuitem", { name: en.log_out })).toBeVisible();
  }
  expect(errors).toEqual([]);

  const response = await page.goto("/nope");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: en.not_found_title })).toBeVisible();
});

test("the login rate limit counts per address", async ({ browser, page }) => {
  const { owner } = readSeed();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await signIn(page, owner.email, "wrong-password-xx");
    await expect(page.getByRole("alert")).toHaveText(en.login_error_credentials);
  }
  await signIn(page, owner.email, "wrong-password-xx");
  await expect(page.getByRole("alert")).toHaveText(en.error_too_many);

  // Another address is another bucket: the same password works at once.
  const fresh = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "x-forwarded-for": nextAddress(addressBase()) },
  });
  try {
    const freshPage = await fresh.newPage();
    await signIn(freshPage, owner.email, owner.password);
    await expect(freshPage).toHaveURL(/\/onboarding$/);
  } finally {
    await fresh.close();
  }
});
