import { execFileSync } from "node:child_process";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { E2E_BASE_URL, e2eEnv, repoRoot } from "../env";
import { cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";
import { holdsToken, totpCode } from "../totp";

// The tests change one user's second factor and depend on each other: one after the other, in this order.
// The two projects run in their own workers, each with its own user, so the module variables below are per project.
test.describe.configure({ mode: "serial" });

type Project = "mobile" | "desktop";

let secret = "";
let codes: string[] = [];

// Per test: every console line, every code typed into the page, every context opened.
let consoleLines: string[] = [];
let typed: string[] = [];
let cspLists: string[][] = [];
let contexts: BrowserContext[] = [];

const projectOf = (name: string): Project => name as Project;
// Blocks 50 and 150 (the other specs use 10..40, 60..100 and the same +100).
const addressBase = (project: string): number => (project === "mobile" ? 50 : 150);

test.beforeEach(() => {
  consoleLines = [];
  typed = [];
  cspLists = [];
  contexts = [];
});

test.afterEach(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  const needles = [secret, "otpauth", ...codes, ...typed].filter((needle) => needle !== "");
  for (const line of consoleLines) {
    for (const needle of needles)
      expect(holdsToken(line, needle), "a console line holds a secret or a code").toBe(false);
  }
  expect(cspLists.flat()).toEqual([]);
});

// Every sign-in runs in a new browser context with its own client address: `/two-factor/*` allows 3 requests per 10 s per address.
async function newSession(browser: Browser, project: string): Promise<Page> {
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "x-forwarded-for": nextAddress(addressBase(project)) },
  });
  contexts.push(context);
  const page = await context.newPage();
  page.on("console", (message) => {
    consoleLines.push(message.text());
  });
  cspLists.push(await cspErrors(page));
  return page;
}

async function type(input: ReturnType<Page["getByLabel"]>, value: string): Promise<void> {
  typed.push(value);
  await input.fill(value);
}

// The password step of the login, then the code step.
async function toCodeStep(page: Page, user: { email: string; password: string }): Promise<void> {
  await signInAs(page, user);
  await expect(page.getByLabel(en.tf_code_label)).toBeVisible();
}

// The other code of two: the wrong one must never equal the right one.
function wrongCode(): string {
  return totpCode(secret) === "000000" ? "111111" : "000000";
}

async function signInWithCode(page: Page, user: { email: string; password: string }): Promise<void> {
  await toCodeStep(page, user);
  await type(page.getByLabel(en.tf_code_label), totpCode(secret));
  await page.getByRole("button", { name: en.tf_verify }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

function breakGlass(args: string[]): void {
  execFileSync("bun", ["apps/server/src/scripts/org-break-glass.ts", ...args], {
    cwd: repoRoot,
    env: e2eEnv(),
    stdio: "pipe",
    timeout: 30_000,
  });
}

test("a wrong password at the start of the set-up shows a linked error and keeps focus on the field", async ({
  browser,
}, testInfo) => {
  const user = readSeed().twoFactorOwners[projectOf(testInfo.project.name)];
  const page = await newSession(browser, testInfo.project.name);
  await signInAs(page, user);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/settings");
  const section = page.locator("[data-section=two-factor]");
  await section.getByRole("button", { name: en.tf_turn_on }).click();

  // Focus moves to the first control of the view that opens.
  const password = section.getByLabel(en.password_label);
  await expect(password).toBeFocused();
  await type(password, "e2e-wrong-account-password");
  await section.getByRole("button", { name: en.continue }).click();

  const error = section.getByText(en.tf_error_password);
  await expect(error).toBeVisible();
  await expect(password).toHaveAttribute("aria-invalid", "true");
  const describedBy = await password.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(en.tf_error_password);
});

test("turn on: password, QR code, code, backup codes", async ({ browser }, testInfo) => {
  const user = readSeed().twoFactorOwners[projectOf(testInfo.project.name)];
  const page = await newSession(browser, testInfo.project.name);
  await signInAs(page, user);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/settings");
  const section = page.locator("[data-section=two-factor]");
  await expect(section.getByText(en.tf_off_text)).toBeVisible();
  await section.getByRole("button", { name: en.tf_turn_on }).click();

  await expect(section.getByLabel(en.password_label)).toBeFocused();
  await section.getByLabel(en.password_label).fill(user.password);

  // A double click runs one enrol request.
  const enrolRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/two-factor/enable")) enrolRequests.push(request.url());
  });
  await section.getByRole("button", { name: en.continue }).dblclick();
  await expect(section.locator("[data-qr=totp]")).toBeVisible();
  expect(enrolRequests).toHaveLength(1);

  // Focus is on the code field of the scan view.
  await expect(section.getByLabel(en.tf_code_label)).toBeFocused();
  const raw = await section.locator("[data-totp-secret]").innerText();
  secret = raw.replace(/\s+/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);

  await type(section.getByLabel(en.tf_code_label), totpCode(secret));
  await section.getByRole("button", { name: en.tf_verify }).click();

  const items = section.locator("[data-backup-codes] li");
  await expect(items).toHaveCount(10);
  codes = await items.allInnerTexts();
  for (const code of codes) expect(code).toMatch(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/);
  // Focus is on the heading of the codes view.
  await expect(section.getByRole("heading", { name: en.tf_codes_title })).toBeFocused();

  await section.getByRole("button", { name: en.tf_codes_done }).click();
  await expect(section.getByText(en.tf_on_text)).toBeVisible();
  await expect(section.getByText(en.tf_codes_left.replace("{count}", "10"))).toBeVisible();
});

test("sign in with a code: a wrong code, then the right one", async ({ browser }, testInfo) => {
  const user = readSeed().twoFactorOwners[projectOf(testInfo.project.name)];
  const page = await newSession(browser, testInfo.project.name);
  await toCodeStep(page, user);

  // Focus moves to the code field when the code step opens.
  const input = page.getByLabel(en.tf_code_label);
  await expect(input).toBeFocused();
  await type(input, wrongCode());
  await page.getByRole("button", { name: en.tf_verify }).click();

  const error = page.getByRole("alert");
  await expect(error).toHaveText(en.tf_error_code);
  const describedBy = await input.getAttribute("aria-describedby");
  expect(describedBy).toContain("tf-error");
  await expect(page.locator("#tf-error")).toHaveText(en.tf_error_code);
  await expect(page).toHaveURL(/\/login$/);

  await type(input, totpCode(secret));
  await page.getByRole("button", { name: en.tf_verify }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("sign in with a backup code, and the same code a second time is refused", async ({ browser }, testInfo) => {
  const user = readSeed().twoFactorOwners[projectOf(testInfo.project.name)];
  const first = await newSession(browser, testInfo.project.name);
  await toCodeStep(first, user);
  await first.getByRole("button", { name: en.tf_use_backup }).click();
  await expect(first.getByLabel(en.tf_backup_label)).toBeFocused();
  await type(first.getByLabel(en.tf_backup_label), codes[0] ?? "");
  await first.getByRole("button", { name: en.tf_verify }).click();
  await expect(first).toHaveURL(/\/onboarding$/);

  const second = await newSession(browser, testInfo.project.name);
  await toCodeStep(second, user);
  await second.getByRole("button", { name: en.tf_use_backup }).click();
  await type(second.getByLabel(en.tf_backup_label), codes[0] ?? "");
  await second.getByRole("button", { name: en.tf_verify }).click();
  await expect(second.getByRole("alert")).toHaveText(en.tf_error_backup_code);
  await expect(second).toHaveURL(/\/login$/);
});

test("a trusted device skips the code step at the next sign-in", async ({ browser }, testInfo) => {
  const user = readSeed().twoFactorOwners[projectOf(testInfo.project.name)];
  const page = await newSession(browser, testInfo.project.name);
  await toCodeStep(page, user);
  await page.getByLabel(en.tf_trust_device).click();
  await type(page.getByLabel(en.tf_code_label), totpCode(secret));
  await page.getByRole("button", { name: en.tf_verify }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  const out = await page.request.post("/api/auth/sign-out", { headers: { origin: E2E_BASE_URL }, data: {} });
  expect(out.ok()).toBe(true);

  await signInAs(page, user);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByLabel(en.tf_code_label)).toHaveCount(0);
});

test("the break-glass owner sees the note and cannot turn it off", async ({ browser }, testInfo) => {
  const user = readSeed().twoFactorOwners[projectOf(testInfo.project.name)];
  breakGlass(["--org-id", user.orgId, "--user-id", user.userId]);
  try {
    const page = await newSession(browser, testInfo.project.name);
    await toCodeStep(page, user);
    await type(page.getByLabel(en.tf_code_label), totpCode(secret));
    await page.getByRole("button", { name: en.tf_verify }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.goto("/settings");

    const section = page.locator("[data-section=two-factor]");
    await expect(section.getByText(en.tf_break_glass_note)).toBeVisible();
    await section.getByRole("button", { name: en.tf_turn_off }).click();
    await section.getByLabel(en.password_label).fill(user.password);
    await section.getByRole("button", { name: en.continue }).click();
    await expect(section.getByText(en.tf_error_break_glass)).toBeVisible();

    // Nothing changed: a reload shows the second factor still on.
    await page.reload();
    await expect(section.getByText(en.tf_on_text)).toBeVisible();
  } finally {
    breakGlass(["--org-id", user.orgId, "--clear"]);
  }
});

test("turn off: the next sign-in asks only for the password", async ({ browser }, testInfo) => {
  const user = readSeed().twoFactorOwners[projectOf(testInfo.project.name)];
  const page = await newSession(browser, testInfo.project.name);
  await signInWithCode(page, user);
  await page.goto("/settings");
  const section = page.locator("[data-section=two-factor]");
  await section.getByRole("button", { name: en.tf_turn_off }).click();
  await expect(section.getByLabel(en.password_label)).toBeFocused();
  await section.getByLabel(en.password_label).fill(user.password);
  await section.getByRole("button", { name: en.continue }).click();
  await expect(page.getByText(en.tf_off_toast)).toBeVisible();
  await expect(section.getByText(en.tf_off_text)).toBeVisible();

  const fresh = await newSession(browser, testInfo.project.name);
  await signInAs(fresh, user);
  await expect(fresh).toHaveURL(/\/onboarding$/);
  await expect(fresh.getByLabel(en.tf_code_label)).toHaveCount(0);
});
