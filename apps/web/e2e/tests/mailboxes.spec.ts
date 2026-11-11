import { expect, test } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { cleanUpOrg, connectGreenMail, cspErrors, mailboxAddress, nextAddress, signIn } from "../helpers";
import { readSeed } from "../seed";

test.describe.configure({ mode: "serial" });

let errors: string[] = [];

// The S5a blocks are 10 and 110; this spec uses 40 and 140.
test.beforeEach(async ({ context, page }, testInfo) => {
  const base = testInfo.project.name === "mobile" ? 40 : 140;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(base) });
  errors = await cspErrors(page);
  const { owner } = readSeed();
  await signIn(page, owner.email, owner.password);
  await expect(page).toHaveURL(/\/onboarding$/);
});

test.afterEach(async ({ page }) => {
  await cleanUpOrg(page);
  expect(errors).toEqual([]);
});

test("connect, pause, resume, change the password, remove", async ({ page }, testInfo) => {
  const address = mailboxAddress(testInfo.project.name);
  await page.goto("/mailboxes");
  await expect(page.getByText(en.mb_empty)).toBeVisible();

  await page.getByRole("button", { name: en.mb_connect }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await connectGreenMail(page, testInfo.project.name);

  await expect(page.getByText(address)).toBeVisible();
  await expect(page.getByText(en.status_active, { exact: true })).toBeVisible();
  await expect(page.getByText(en.badge_triage_off)).toBeVisible();
  await expect(page.getByText(en.badge_actions_synthetic)).toBeVisible();
  await expect(page.getByText(en.badge_send_off)).toBeVisible();

  await page.getByRole("button", { name: en.mb_pause }).click();
  await expect(page.getByText(en.mb_paused_toast)).toBeVisible();
  await expect(page.getByText(en.status_paused, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: en.mb_resume }).click();
  await expect(page.getByText(en.status_active, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: en.mb_more }).click();
  await page.getByRole("menuitem", { name: en.mb_change_password }).click();
  const passwordDialog = page.getByRole("dialog");
  await passwordDialog.getByLabel(en.mb_new_password_label, { exact: true }).fill("e2e-new-password");
  await passwordDialog.getByRole("button", { name: en.save }).click();
  await expect(page.getByText(en.password_saved, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: en.mb_more }).click();
  await page.getByRole("menuitem", { name: en.mb_remove }).click();
  const removeDialog = page.getByRole("dialog");
  const submit = removeDialog.getByRole("button", { name: en.remove_submit });
  await expect(submit).toBeDisabled();
  await removeDialog.getByLabel(en.remove_confirm_label).fill(address.toUpperCase());
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText(en.removed_toast)).toBeVisible();
  await expect(page.getByText(en.mb_empty)).toBeVisible();
});

test("a preset sends no host fields", async ({ page }) => {
  let kept: Record<string, unknown> | undefined;
  await page.route("**/api/mailboxes", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    kept = request.postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ error: "mail_login_failed" }),
    });
  });

  await page.goto("/mailboxes");
  await page.getByRole("button", { name: en.mb_connect }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(en.address_label).fill("anna@gmail.com");
  await expect(dialog.getByRole("combobox", { name: en.provider_label })).toHaveText(en.preset_gmail);
  await dialog.getByLabel(en.mb_app_password_label, { exact: true }).fill("abcdabcdabcdabcd");
  await dialog.getByRole("button", { name: en.connect_submit }).click();

  await expect(dialog.getByRole("alert")).toHaveText(en.err_mail_login_failed);
  expect(kept).toBeDefined();
  expect(kept).toMatchObject({ preset: "gmail", secretKind: "app_password" });
  for (const key of ["imapHost", "imapPort", "smtpHost", "smtpPort"]) {
    expect(kept).not.toHaveProperty(key);
  }
});

test("the connect link opens the dialog", async ({ page }) => {
  await page.goto("/mailboxes?connect=1");
  await expect(page.getByRole("dialog").getByText(en.connect_title)).toBeVisible();
  expect(page.url()).not.toContain("connect=1");
});
