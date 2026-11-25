import { expect, test, type Page } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { t } from "../../src/i18n";
import { expectNoA11yViolations } from "../a11y";
import {
  cleanUpOrg,
  connectGreenMail,
  consoleErrors,
  cspErrors,
  mailboxAddress,
  nextAddress,
  signInAs,
} from "../helpers";
import { readSeed } from "../seed";
import { MINUTE_MS } from "@ea/core";

test.describe.configure({ mode: "serial" });

let errors: string[] = [];
let logged: string[] = [];

// The earlier blocks are 10 and 110, 40 and 140; this spec uses 60 and 160.
test.beforeEach(async ({ context, page }, testInfo) => {
  const base = testInfo.project.name === "mobile" ? 60 : 160;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(base) });
  errors = await cspErrors(page);
  logged = consoleErrors(page);
  await signInAs(page, readSeed().owner);
  await expect(page).toHaveURL(/\/onboarding$/);
});

test.afterEach(async ({ page }) => {
  await cleanUpOrg(page);
  expect(errors).toEqual([]);
});

// Records at once, in the browser, if the text ever shows on a page that loads after this call.
async function watchText(page: Page, text: string): Promise<() => Promise<boolean>> {
  await page.addInitScript((watched) => {
    const state = window as unknown as { seenText?: boolean };
    state.seenText = false;
    new MutationObserver(() => {
      if (document.body?.innerText.includes(watched)) state.seenText = true;
    }).observe(document, { childList: true, subtree: true, characterData: true });
  }, text);
  return () => page.evaluate(() => (window as unknown as { seenText?: boolean }).seenText === true);
}

test("mode, switch and auto", async ({ page }, testInfo) => {
  test.setTimeout(MINUTE_MS);
  const project = testInfo.project.name;
  await page.goto("/mailboxes?connect=1");
  await connectGreenMail(page, project);
  await expect(page.getByText(mailboxAddress(project))).toBeVisible();

  const seenNoMailbox = await watchText(page, en.set_no_mailbox);
  logged.length = 0;
  await page.goto("/settings");
  await expect(page.getByRole("combobox", { name: en.set_mailbox_label })).toHaveText(mailboxAddress(project));
  const mode = page.locator("[data-card=mode]");
  await expect(mode.getByText(en.mode_shadow, { exact: true })).toBeVisible();
  await expect(page.locator("[data-card=folders]")).toBeVisible();
  // With the flag `reply_drafts` off (the main organization) the style card keeps the name and the signature; the switch,
  // the writing style and Preview are gone.
  const style = page.locator("[data-card=reply-style]");
  await expect(style.getByLabel(en.rs_name_label, { exact: true })).toBeVisible();
  await expect(style.getByLabel(en.rs_signature_label, { exact: true })).toBeVisible();
  await expect(style.getByLabel(en.rs_style_label, { exact: true })).toHaveCount(0);
  await expect(style.getByRole("button", { name: en.rs_preview })).toHaveCount(0);
  await expect(mode.getByRole("switch", { name: en.switch_reply_drafts, exact: true })).toHaveCount(0);
  expect(await seenNoMailbox()).toBe(false);
  expect(logged).toEqual([]);
  await expectNoA11yViolations(page);

  // The assist dialog.
  await mode.getByRole("button", { name: en.mode_to_assist }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(en.assist_title)).toBeVisible();
  await expect(dialog.getByText(en.badge_triage_off)).toBeVisible();
  await expect(dialog.getByText(en.badge_actions_synthetic)).toBeVisible();
  // The e2e server has SEND_SCOPE=self (the approvals spec sends one mail to a test address): see `e2e/env.ts`.
  await expect(dialog.getByText(en.badge_send_self)).toBeVisible();
  await expectNoA11yViolations(page);
  await dialog.getByRole("button", { name: en.assist_usual }).click();
  await expect(page.getByText(en.mode_assist_toast)).toBeVisible();
  await expect(mode.getByText(en.mode_assist, { exact: true })).toBeVisible();
  await expect(mode.getByRole("switch", { name: en.switch_move, exact: true })).toBeChecked();

  // A tool switch.
  await mode.getByRole("switch", { name: en.switch_flag, exact: true }).click();
  await expect(page.getByText(t("switch_off_toast", { name: en.switch_flag }))).toBeVisible();
  await expect(mode.getByRole("switch", { name: en.switch_flag, exact: true })).not.toBeChecked();

  // Auto on a category without a pass: refused, then "Set anyway".
  const autoInfo = page.getByRole("switch", { name: t("cat_auto_label", { category: en.cat_info }), exact: true });
  const gateText = t("gate_too_few", { kept: 0, minKept: 30, at: "0.5" });
  await autoInfo.click();
  const anyway = page.getByRole("dialog");
  await expect(anyway.getByText(en.anyway_title)).toBeVisible();
  await expect(anyway.getByText(gateText)).toBeVisible();
  await anyway.getByRole("button", { name: en.cancel }).click();
  await expect(anyway).toHaveCount(0);
  await expect(autoInfo).not.toBeChecked();

  await autoInfo.click();
  await expect(anyway.getByText(en.anyway_title)).toBeVisible();
  await anyway.getByRole("button", { name: en.anyway_submit }).click();
  await expect(page.getByText(t("auto_on_toast", { category: en.cat_info }))).toBeVisible();
  await expect(autoInfo).toBeChecked();

  // The seeded mail server lists INBOX only.
  await expect(page.locator("[data-card=folders]").getByText(en.folders_only_inbox)).toBeVisible();

  await mode.getByRole("button", { name: en.mode_to_shadow }).click();
  await expect(page.getByText(en.mode_shadow_toast)).toBeVisible();
  await expect(mode.getByText(en.mode_shadow, { exact: true })).toBeVisible();
});

test("frame: four sections, section links, one h1", async ({ page }, testInfo) => {
  test.setTimeout(MINUTE_MS);
  const project = testInfo.project.name;
  await page.goto("/mailboxes?connect=1");
  await connectGreenMail(page, project);
  await expect(page.getByText(mailboxAddress(project))).toBeVisible();

  await page.goto("/settings");
  await expect(page.locator("[data-card=mode]")).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByText(en.set_lead)).toBeVisible();
  // The owner sees no read-only line.
  await expect(page.getByText(en.set_owner_only)).toHaveCount(0);
  for (const name of ["mode", "categories", "folders", "reply-style", "digest", "timezone", "account"]) {
    await expect(page.locator(`[data-card=${name}]`)).toBeVisible();
  }
  for (const label of [en.set_group_mailbox, en.set_group_notices, en.set_group_organization, en.set_group_account]) {
    await expect(page.getByRole("region", { name: label })).toBeVisible();
  }
  await expectNoA11yViolations(page);

  const nav = page.getByRole("navigation", { name: en.set_nav_label });
  await expect(nav.getByRole("link")).toHaveCount(4);
  await expect(page.locator("#account")).not.toBeInViewport();
  await nav.getByRole("link", { name: en.set_group_account }).click();
  await expect(page.locator("#account")).toBeInViewport();
  await expect(page).toHaveURL(/\/settings(\?[^#]*)?#account$/);

  // A cold load with a group id in the hash scrolls to that group once the mailbox cards are there.
  await page.goto("about:blank");
  await page.goto("/settings#notices");
  await expect(page.locator("[data-card=mode]")).toBeVisible();
  await expect(page.locator("#notices")).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  // An unknown hash scrolls nowhere.
  await page.goto("about:blank");
  await page.goto("/settings#nothing");
  await expect(page.locator("[data-card=mode]")).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("general: digest time, signature, timezone", async ({ page }) => {
  logged.length = 0;
  await page.goto("/settings");
  const digest = page.locator("[data-card=digest]");
  await expect(digest).toBeVisible();
  await expect(page.locator("[data-card=timezone]")).toBeVisible();
  // No mailbox: the mailbox group says so, and the other three groups work without one.
  await expect(page.getByRole("heading", { name: en.set_no_mailbox })).toBeVisible();
  await expect(page.getByRole("link", { name: en.set_open_mailboxes })).toHaveAttribute("href", "/mailboxes");
  for (const label of [en.set_group_notices, en.set_group_organization, en.set_group_account]) {
    await expect(page.getByRole("region", { name: label })).toBeVisible();
  }
  expect(logged).toEqual([]);

  await digest.getByRole("button", { name: en.digest_add }).click();
  await digest.getByLabel(t("digest_time_label", { n: 1 }), { exact: true }).fill("08:00");
  await digest.getByRole("button", { name: en.save }).click();
  await expect(page.getByText(en.digest_saved_toast)).toBeVisible();
  await page.reload();
  await expect(
    page.locator("[data-card=digest]").getByLabel(t("digest_time_label", { n: 1 }), { exact: true })
  ).toHaveValue("08:00");

  const timezone = page.locator("[data-card=timezone]");
  await timezone.getByLabel(en.tz_search_label).fill("london");
  await timezone.getByLabel(en.tz_list_label, { exact: true }).selectOption("Europe/London");
  await timezone.getByRole("button", { name: en.save }).click();
  await expect(page.getByText(t("tz_saved_toast", { timezone: "Europe/London" }))).toBeVisible();
  await expect(timezone.getByText(t("tz_current", { timezone: "Europe/London" }))).toBeVisible();

  // And back.
  await timezone.getByLabel(en.tz_search_label).fill("warsaw");
  await timezone.getByLabel(en.tz_list_label, { exact: true }).selectOption("Europe/Warsaw");
  await timezone.getByRole("button", { name: en.save }).click();
  await expect(timezone.getByText(t("tz_current", { timezone: "Europe/Warsaw" }))).toBeVisible();
});
