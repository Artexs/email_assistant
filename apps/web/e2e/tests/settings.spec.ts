import { expect, test, type Page } from "@playwright/test";

import { en, t } from "../../src/i18n/en";
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

test.describe.configure({ mode: "serial" });

let errors: string[] = [];
let logged: string[] = [];

// The S5a blocks are 10 and 110, S5b 40 and 140; this spec uses 60 and 160.
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
  test.setTimeout(60_000);
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
  await expect(page.locator("[data-card=signature]")).toBeVisible();
  expect(await seenNoMailbox()).toBe(false);
  expect(logged).toEqual([]);

  // The assist dialog.
  await mode.getByRole("button", { name: en.mode_to_assist }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(en.assist_title)).toBeVisible();
  await expect(dialog.getByText(en.badge_triage_off)).toBeVisible();
  await expect(dialog.getByText(en.badge_actions_synthetic)).toBeVisible();
  await expect(dialog.getByText(en.badge_send_off)).toBeVisible();
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

test("general: digest time, signature, timezone", async ({ page }) => {
  logged.length = 0;
  await page.goto("/settings");
  const digest = page.locator("[data-card=digest]");
  await expect(digest).toBeVisible();
  await expect(page.locator("[data-card=timezone]")).toBeVisible();
  // No mailbox: the page says so, and the general section works without one.
  await expect(page.getByText(en.set_no_mailbox)).toBeVisible();
  expect(logged).toEqual([]);

  await digest.getByRole("button", { name: en.digest_add }).click();
  await digest.getByLabel(t("digest_time_label", { n: 1 }), { exact: true }).fill("08:00");
  await digest.getByRole("button", { name: en.save }).click();
  await expect(page.getByText(en.digest_saved_toast)).toBeVisible();
  await page.reload();
  await expect(
    page.locator("[data-card=digest]").getByLabel(t("digest_time_label", { n: 1 }), { exact: true })
  ).toHaveValue("08:00");

  const signature = page.locator("[data-card=signature]");
  await signature.getByLabel(en.sig_label).fill("E2E Owner\nCEO");
  await signature.getByRole("button", { name: en.save }).click();
  await expect(page.getByText(en.sig_saved_toast)).toBeVisible();

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
