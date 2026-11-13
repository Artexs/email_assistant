import { expect, test } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { E2E_BASE_URL } from "../env";
import { consoleErrors, cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

test.describe.configure({ mode: "serial" });

let errors: string[] = [];
let logged: string[] = [];

// The account spec changes no organization data: no cleanup. Blocks: 80 and 180.
test.beforeEach(async ({ context, page }, testInfo) => {
  const base = testInfo.project.name === "mobile" ? 80 : 180;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(base) });
  errors = await cspErrors(page);
  logged = consoleErrors(page);
  await signInAs(page, readSeed().members[testInfo.project.name as "mobile" | "desktop"]);
  await expect(page).toHaveURL(/\/onboarding$/);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test("an assistant sees the settings read-only", async ({ page }) => {
  logged.length = 0;
  await page.goto("/settings");
  await expect(page.getByText(en.set_no_mailbox)).toBeVisible();
  await expect(page.getByText(en.set_owner_only)).toBeVisible();
  await expect(page.getByRole("button", { name: en.mode_to_assist })).toHaveCount(0);
  await expect(page.getByLabel(en.sig_label)).not.toBeEditable();
  await expect(page.locator("[data-card=signature]").getByRole("button", { name: en.save })).toHaveCount(0);
  await expect(page.locator("[data-card=timezone]").getByRole("button", { name: en.save })).toHaveCount(0);
  // The member's own digest times stay editable.
  await expect(page.locator("[data-card=digest]").getByRole("button", { name: en.digest_add })).toBeEnabled();
  expect(logged).toEqual([]);

  logged.length = 0;
  await page.goto("/rules");
  await expect(page.getByText(en.set_owner_only)).toBeVisible();
  await expect(page.locator("[data-kind=vip]")).toBeVisible();
  await expect(page.getByRole("button", { name: en.rules_add })).toHaveCount(0);
  expect(logged).toEqual([]);
});

test("the account card lists the signed-in devices", async ({ page, browser }, testInfo) => {
  const member = readSeed().members[testInfo.project.name as "mobile" | "desktop"];
  await page.goto("/settings");
  const account = page.locator("[data-card=account]");
  await expect(account.getByText(en.acct_sessions_title)).toBeVisible();
  const rows = account.locator("[data-session]");
  await expect(rows).toHaveCount(1);
  await expect(rows.locator("[data-badge=this-device]")).toHaveText(en.acct_this_device);

  // A second sign-in of the same user: a new context with its own client address.
  const other = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "x-forwarded-for": nextAddress(testInfo.project.name === "mobile" ? 80 : 180) },
  });
  try {
    const otherPage = await other.newPage();
    await signInAs(otherPage, member);
    await expect(otherPage).toHaveURL(/\/onboarding$/);

    await page.reload();
    await expect(rows).toHaveCount(2);
    await expect(account.locator("[data-badge=this-device]")).toHaveCount(1);
  } finally {
    await other.close();
  }
});

test("change the password and sign out everywhere", async ({ page, context, browser }, testInfo) => {
  const member = readSeed().members[testInfo.project.name as "mobile" | "desktop"];
  const newPassword = "e2e-member-passphrase-two";

  // A second device: its own context and client address.
  const other = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "x-forwarded-for": nextAddress(testInfo.project.name === "mobile" ? 80 : 180) },
  });
  try {
    const otherPage = await other.newPage();
    await signInAs(otherPage, member);
    await expect(otherPage).toHaveURL(/\/onboarding$/);
    expect((await other.request.get("/api/me")).status()).toBe(200);

    await page.goto("/settings");
    const account = page.locator("[data-card=account]");
    await expect(account).toBeVisible();
    const current = account.getByLabel(en.acct_current_label, { exact: true });
    await current.fill("e2e-wrong-current-password");
    await account.getByLabel(en.new_password_label, { exact: true }).fill(newPassword);
    await account.getByLabel(en.repeat_password_label, { exact: true }).fill(newPassword);
    await account.getByRole("button", { name: en.acct_change }).click();
    await expect(account.getByRole("alert")).toHaveText(en.acct_wrong_current);

    await current.fill(member.password);
    await account.getByRole("button", { name: en.acct_change }).click();
    await expect(page.getByText(en.acct_changed_others_toast)).toBeVisible();

    // "Sign out my other devices" was on: the second device lost its session.
    expect((await other.request.get("/api/me")).status()).toBe(401);
  } finally {
    await other.close();
  }

  await context.clearCookies();
  await signInAs(page, { email: member.email, password: newPassword });
  await expect(page).toHaveURL(/\/onboarding$/);
  expect((await page.request.get("/api/me")).status()).toBe(200);

  await page.goto("/settings");
  await page.getByRole("button", { name: en.acct_sign_out_all }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/me")).status()).toBe(401);
});
