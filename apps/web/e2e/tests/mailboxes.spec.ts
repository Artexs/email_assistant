import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
import { expectNoA11yViolations } from "../a11y";
import { cleanUpOrg, connectGreenMail, cspErrors, mailboxAddress, nextAddress, signIn } from "../helpers";
import { readSeed } from "../seed";
import { sheetDir } from "../ui-sheet/dir";

// A mailbox card: the only card with a `data-state` (Radix parts carry the same attribute).
const CARD = '[data-slot="card"][data-state]';

test.describe.configure({ mode: "serial" });

let errors: string[] = [];

// The earlier blocks are 10 and 110; this spec uses 40 and 140.
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
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: en.mb_connect }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoA11yViolations(page);
  await connectGreenMail(page, testInfo.project.name);

  await expect(page.getByText(address)).toBeVisible();
  // A new mailbox has no sync yet; a quick first sync makes it "connected". Both are the healthy look.
  await expect(page.locator(CARD)).toHaveAttribute("data-state", /^(connected|never_synced)$/);
  await expect(page.getByText(en.badge_triage_off)).toBeVisible();
  await expect(page.getByText(en.badge_actions_synthetic)).toBeVisible();
  // The e2e server has SEND_SCOPE=self (the approvals spec sends one mail to a test address): see `e2e/env.ts`.
  await expect(page.getByText(en.badge_send_self)).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: en.mb_pause }).click();
  await expect(page.getByText(en.mb_paused_toast)).toBeVisible();
  await expect(page.locator(CARD)).toHaveAttribute("data-state", "paused");
  await expect(page.getByText(en.status_paused, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: en.mb_resume }).click();
  await expect(page.locator(CARD)).toHaveAttribute("data-state", /^(connected|never_synced)$/);

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

const SYNCED = "2026-11-20T08:00:00.000Z";
const SCOPES = {
  triage: { state: "on", reason: "all_mailboxes" },
  actions: { state: "on", reason: "by_mode" },
  send: { state: "on", reason: "after_approval" },
};

function mailboxFixture(index: number, overrides: Record<string, unknown>) {
  return {
    id: `6f1d0b3c-8a2e-4f7a-9d55-3b1c2a4e5f6${index}`,
    address: `box${index}.with.a.long.local.part@example-company.example`,
    status: "active",
    statusChangedAt: SYNCED,
    createdAt: SYNCED,
    lastSyncedAt: SYNCED,
    mode: "shadow",
    movesSupported: true,
    secretKind: "password",
    authMethod: "password",
    oauthProvider: null,
    authReason: null,
    scopes: SCOPES,
    ...overrides,
  };
}

// One mailbox for each of the six card states.
const SIX_STATES = [
  ["connected", mailboxFixture(0, {})],
  ["never_synced", mailboxFixture(1, { lastSyncedAt: null })],
  ["paused", mailboxFixture(2, { status: "paused", mode: "assist" })],
  ["login_error", mailboxFixture(3, { status: "auth_error" })],
  ["host_refused", mailboxFixture(4, { status: "host_blocked" })],
  [
    "access_revoked",
    mailboxFixture(5, {
      status: "auth_error",
      authMethod: "oauth",
      oauthProvider: "google",
      authReason: "oauth_revoked",
    }),
  ],
] as const;

test("each of the six states has its own card; pictures go to the sheet folder", async ({ page }, testInfo) => {
  await page.route("**/api/mailboxes", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({ json: SIX_STATES.map(([, mailbox]) => mailbox) });
  });
  const folder = join(sheetDir(), "f170-07");
  mkdirSync(folder, { recursive: true });

  await page.goto("/mailboxes");
  await expect(page.getByRole("heading", { level: 1, name: en.title_mailboxes })).toBeVisible();
  await expect(page.getByText(en.mb_lead)).toBeVisible();
  for (const [state] of SIX_STATES) await expect(page.locator(`${CARD}[data-state="${state}"]`)).toHaveCount(1);
  await expect(page.locator(CARD)).toHaveCount(SIX_STATES.length);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);

  // The OAuth card offers Reconnect and no password change; the password card the reverse.
  const revoked = page.locator(`${CARD}[data-state="access_revoked"]`);
  await expect(revoked.getByRole("button", { name: en.mb_reconnect })).toBeVisible();
  await expect(revoked.getByRole("button", { name: en.mb_change_password })).toHaveCount(0);
  await expect(revoked.getByText(en.mb_access_revoked_hint)).toBeVisible();
  const login = page.locator(`${CARD}[data-state="login_error"]`);
  await expect(login.getByRole("button", { name: en.mb_change_password })).toBeVisible();
  await expect(login.getByRole("button", { name: en.mb_reconnect })).toHaveCount(0);
  await expect(page.locator(`${CARD}[data-state="host_refused"]`).getByRole("button")).toHaveCount(1);
  await expectNoA11yViolations(page);

  for (const [locale, texts] of [
    ["en", en],
    ["pl", pl],
  ] as const) {
    await page.evaluate((value) => localStorage.setItem("ea.locale", value), locale);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: texts.title_mailboxes })).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({
        path: join(folder, `mailboxes-states-${testInfo.project.name}-${scheme}-${locale}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => localStorage.setItem("ea.locale", "en"));
});

test("a member sees the cards but no connect action and no button", async ({ page }) => {
  // The seed owner's page with the role of the answer of `/api/me` set to member.
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    const me = (await response.json()) as { role: string };
    await route.fulfill({ response, json: { ...me, role: "member" } });
  });
  await page.route("**/api/mailboxes", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({ json: SIX_STATES.map(([, mailbox]) => mailbox) });
  });
  await page.goto("/mailboxes");
  await expect(page.locator(CARD)).toHaveCount(SIX_STATES.length);
  await expect(page.getByRole("button", { name: en.mb_connect })).toHaveCount(0);
  await expect(page.locator(CARD).getByRole("button")).toHaveCount(0);
});
