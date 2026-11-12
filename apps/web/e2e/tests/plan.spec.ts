import { expect, test, type Page } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { trialDateText } from "../../src/lib/trial-date";
import { E2E_BASE_URL, e2eEnv } from "../env";
import { cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

test.describe.configure({ mode: "serial" });

let errors: string[] = [];

// The plan spec changes no data: no cleanup. Blocks: 90 and 190.
test.beforeEach(async ({ context, page }, testInfo) => {
  const base = testInfo.project.name === "mobile" ? 90 : 190;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(base) });
  errors = await cspErrors(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

// The sign-in lands on /onboarding (nothing is set up in these organizations): wait for it, so a `goto` cannot cut the sign-in off.
async function signInAndWait(page: Page, user: { email: string; password: string }): Promise<void> {
  await signInAs(page, user);
  await expect(page).toHaveURL(/\/onboarding$/);
}

const pausedText = (): string => {
  const contact = e2eEnv().OPERATOR_CONTACT;
  return contact === undefined || contact === ""
    ? en.paused_banner_no_contact
    : en.paused_banner.replace("{contact}", contact);
};

test("the trial owner sees the end date and no paused banner", async ({ page }) => {
  const { trialOwner } = readSeed();
  await signInAndWait(page, trialOwner);
  await page.goto("/activity");
  const date = trialDateText(trialOwner.trialEndsAt, "Europe/Warsaw");
  await expect(page.getByText(en.trial_ends_on.replace("{date}", date))).toBeVisible();
  await expect(page.getByText(pausedText())).toHaveCount(0);
});

test("the paused owner sees the banner and a read-only panel", async ({ page }) => {
  const { pausedOwner } = readSeed();
  await signInAndWait(page, pausedOwner);

  await page.goto("/activity");
  await expect(page.getByText(pausedText())).toBeVisible();
  await expect(page.getByText(/Trial ends on/)).toHaveCount(0);

  await page.goto("/mailboxes");
  await expect(page.getByText("e2e-paused-box@x.test")).toBeVisible();
  await expect(page.getByRole("button", { name: en.mb_connect })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.mb_pause })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.mb_change_password })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.mb_remove })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.mb_more })).toHaveCount(0);

  await page.goto("/settings");
  await expect(page.getByText("e2e-paused-box@x.test").first()).toBeVisible();
  await expect(page.getByRole("button", { name: en.mode_to_assist })).toHaveCount(0);
  // The switches of the mailbox cards, not the account card's own switch. The folders card has none: the seed has only the inbox.
  for (const card of ["mode", "categories"]) {
    await expect(page.locator(`[data-card=${card}]`)).toBeVisible();
    const switches = page.locator(`[data-card=${card}]`).getByRole("switch");
    expect(await switches.count()).toBeGreaterThan(0);
    for (const item of await switches.all()) await expect(item).toBeDisabled();
  }
  for (const item of await page.locator("[data-card=folders]").getByRole("switch").all()) {
    await expect(item).toBeDisabled();
  }
  await expect(page.locator("[data-card=digest]").getByRole("button", { name: en.digest_add })).toBeDisabled();
});

test("a write of the paused owner gets 403 org_suspended", async ({ page }) => {
  await signInAndWait(page, readSeed().pausedOwner);
  await page.goto("/activity");
  const response = await page.request.patch("/api/me/digest-times", {
    headers: { origin: E2E_BASE_URL },
    data: { times: ["08:00"] },
  });
  expect(response.status()).toBe(403);
  expect(((await response.json()) as { error?: string }).error).toBe("org_suspended");
});

test("the paused owner can sign out", async ({ page }, testInfo) => {
  await signInAndWait(page, readSeed().pausedOwner);
  await page.goto("/activity");
  await expect(page.getByText(pausedText())).toBeVisible();
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: en.menu_open }).click();
    await page.getByRole("dialog").getByRole("button", { name: en.log_out }).click();
  } else {
    await page.getByRole("button", { name: en.user_menu }).click();
    await page.getByRole("menuitem", { name: en.log_out }).click();
  }
  await expect(page).toHaveURL(/\/login$/);
});

test("the active owner sees neither line", async ({ page }) => {
  await signInAndWait(page, readSeed().owner);
  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: en.title_activity }).first()).toBeVisible();
  await expect(page.getByText(/Trial ends on/)).toHaveCount(0);
  await expect(page.getByText(en.paused_banner_no_contact)).toHaveCount(0);
  await expect(page.getByText(/This account is paused/)).toHaveCount(0);
});
