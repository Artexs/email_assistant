import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
import { expectNoA11yViolations } from "../a11y";
import { E2E_BASE_URL } from "../env";
import { consoleErrors, cspErrors, dropSession, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";
import { sheetDir } from "../ui-sheet/dir";

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

// The account and security cards of the owner of the seed organization, with the security log on and three entries. The
// seed has no organization with the flag, so the spec adds it to the answer of `/api/me`; the cards are the real ones.
test("the security card has the two-factor section and the log; pictures go to the sheet folder", async ({
  page,
  context,
}, testInfo) => {
  await dropSession(page, context);
  await signInAs(page, readSeed().owner);
  await expect(page).toHaveURL(/\/onboarding$/);
  let panelLocale: "en" | "pl" = "en";
  await page.route("**/api/me", async (route) => {
    const response = await route.fetch();
    const me = (await response.json()) as { features: string[]; user: object };
    await route.fulfill({
      response,
      json: { ...me, features: [...me.features, "security_log"], user: { ...me.user, locale: panelLocale } },
    });
  });
  await page.route("**/api/security-log", (route) =>
    route.fulfill({
      json: {
        entries: [
          {
            at: "2026-11-20T08:00:00Z",
            kind: "locked",
            actor: { kind: "member", name: "Ala" },
            lockedUntil: "2026-11-20T08:15:00Z",
          },
          {
            at: "2026-11-19T17:30:00Z",
            kind: "password_changed",
            actor: { kind: "member", name: "Ala" },
            lockedUntil: null,
          },
          { at: "2026-11-18T06:05:00Z", kind: "sign_in", actor: { kind: "system" }, lockedUntil: null },
        ],
      },
    })
  );
  const folder = join(sheetDir(), "f170-05");
  mkdirSync(folder, { recursive: true });

  for (const [locale, texts] of [
    ["en", en],
    ["pl", pl],
  ] as const) {
    panelLocale = locale;
    await page.goto("/settings");
    const security = page.locator("[data-card=security]");
    await expect(security.getByRole("heading", { level: 2, name: texts.acct_security_title })).toBeVisible();
    await expect(security.locator("[data-section=two-factor]")).toBeVisible();
    await expect(security.locator("[data-section=two-factor] [data-badge=two-factor]")).toHaveText(texts.tf_status_off);
    await expect(security.locator("[data-section=security-log] [data-slot=row]")).toHaveCount(3);
    // A card per group: the account card holds neither the two-factor section nor the log.
    await expect(page.locator("[data-card=account] [data-section=two-factor]")).toHaveCount(0);
    await expect(page.locator("[data-card=account] [data-section=security-log]")).toHaveCount(0);
    if (locale === "en") await expectNoA11yViolations(page);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const card of ["account", "security"]) {
        await page.locator(`[data-card=${card}]`).screenshot({
          path: join(folder, `${card}-card-${testInfo.project.name}-${scheme}-${locale}.png`),
          animations: "disabled",
        });
      }
    }
    await page.emulateMedia({ colorScheme: "light" });
  }
});

test("the account card lists the signed-in devices", async ({ page, browser }, testInfo) => {
  const member = readSeed().members[testInfo.project.name as "mobile" | "desktop"];
  // Earlier tests of this member left their sessions: end every session but this one.
  const revoked = await page.request.post("/api/auth/revoke-other-sessions", {
    headers: { origin: E2E_BASE_URL },
    data: {},
  });
  expect(revoked.status()).toBe(200);
  await page.goto("/settings");
  const account = page.locator("[data-card=account]");
  await expect(account.getByText(en.acct_sessions_title)).toBeVisible();
  const rows = account.locator("[data-session]");
  await expect(rows).toHaveCount(1);
  await expect(rows.locator("[data-badge=this-device]")).toHaveText(en.acct_this_device);
  await expectNoA11yViolations(page);

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

  await dropSession(page, context);
  await signInAs(page, { email: member.email, password: newPassword });
  await expect(page).toHaveURL(/\/onboarding$/);
  expect((await page.request.get("/api/me")).status()).toBe(200);

  // Later specs (the Telegram detail spec) sign in as this member with the seed password: put it back.
  const restored = await page.request.post("/api/auth/change-password", {
    headers: { origin: E2E_BASE_URL },
    data: { currentPassword: newPassword, newPassword: member.password, revokeOtherSessions: false },
  });
  expect(restored.status()).toBe(200);

  await page.goto("/settings");
  await page.getByRole("button", { name: en.acct_sign_out_all }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/me")).status()).toBe(401);
});
