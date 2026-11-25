import { execFileSync } from "node:child_process";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { createFakeTelegramClient } from "../../../../tools/fake-telegram/src/driver";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { e2eEnv, E2E_BASE_URL, E2E_TELEGRAM_URL, repoRoot } from "../env";
import { cleanUpOrg, cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";
import { MINUTE_MS } from "@ea/core";

// The Telegram detail choice (the link step and the linked card), the owner's lock and the notice routes. The flags `telegram_minimal`
// and `web_push` are on for the seed organization only while a test needs them. The server keeps its real routes and its real store.
test.describe.configure({ mode: "serial" });

function setFlag(flag: "telegram_minimal" | "web_push", enabled: boolean, orgId = readSeed().orgId): void {
  execFileSync(
    "bun",
    ["apps/server/src/scripts/org-flag.ts", "--org-id", orgId, "--flag", flag, enabled ? "--on" : "--off"],
    { cwd: repoRoot, env: e2eEnv(), stdio: "pipe" }
  );
}

const headers = { origin: E2E_BASE_URL };
const projectOf = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
let errors: string[] = [];

test.beforeAll(() => {
  setFlag("telegram_minimal", false);
  setFlag("web_push", false);
});
test.afterAll(() => {
  setFlag("telegram_minimal", false);
  setFlag("web_push", false);
});

test.beforeEach(async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(projectOf() === "mobile" ? 400 : 500) });
  errors = await cspErrors(page);
  await signInAs(page, readSeed().owner);
  await expect(page).toHaveURL(/\/onboarding$/);
});

test.afterEach(async ({ page }) => {
  // Put the seed organization back: the lock off, the owner's level `minimal`, no chat link, both flags off.
  setFlag("telegram_minimal", true);
  await page.request.patch("/api/organization/telegram-lock", { headers, data: { locked: false } });
  await page.request.patch("/api/me/telegram-detail", { headers, data: { detail: "minimal" } });
  await cleanUpOrg(page);
  setFlag("telegram_minimal", false);
  setFlag("web_push", false);
  expect(errors).toEqual([]);
});

// A second signed-in browser: the member of the seed organization.
async function asMember(browser: Browser): Promise<{ page: Page; close(): Promise<void> }> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": nextAddress(projectOf() === "mobile" ? 410 : 510) },
  });
  const page = await context.newPage();
  await signInAs(page, readSeed().members[projectOf()]);
  await expect(page).toHaveURL(/\/onboarding$/);
  return { page, close: () => context.close() };
}

test("flag off: no choice in the link step, no lock card, no route card, and no request for them", async ({ page }) => {
  // The panel reads and writes the detail, the lock and the routes only with their flags on.
  const requests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/(me\/telegram-detail|organization\/telegram-lock|me\/notify|me\/push)/.test(path)) {
      requests.push(`${request.method()} ${path}`);
    }
  });
  await page.goto("/mailboxes");
  const tick = page.getByLabel(en.tg_consent_label);
  await expect(tick).toBeVisible();
  await expect(page.locator("[data-section=telegram-detail]")).toHaveCount(0);
  await tick.check();
  await expect(page.getByRole("button", { name: en.tg_link })).toBeEnabled();

  await page.goto("/settings");
  await expect(page.getByRole("region", { name: en.set_group_notices })).toBeVisible();
  await expect(page.locator("[data-card=timezone]")).toBeVisible();
  await expect(page.locator("[data-card=telegram-lock]")).toHaveCount(0);
  await expect(page.locator("[data-card=notice-routes]")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(requests).toEqual([]);
});

test("flag on: minimal is preselected, full needs the tick, the linked card shows and changes the level", async ({
  page,
}) => {
  test.setTimeout(MINUTE_MS);
  setFlag("telegram_minimal", true);
  await page.goto("/mailboxes");
  const section = page.locator("[data-section=telegram-detail]");
  const minimal = section.getByRole("radio", { name: en.tgd_minimal_option });
  const full = section.getByRole("radio", { name: en.tgd_full_option });
  await expect(minimal).toBeChecked();
  await expect(full).not.toBeChecked();
  await expect(section.getByText(en.tgd_minimal_text)).toBeVisible();
  await expect(section.getByText(en.tgd_full_text)).toBeVisible();
  await expectNoA11yViolations(page, { include: "[data-section=telegram-detail]" });

  // Full without the tick keeps the link button off; the tick turns it on; minimal again keeps it on.
  const linkButton = page.getByRole("button", { name: en.tg_link });
  await full.check();
  await expect(linkButton).toBeDisabled();
  await page.getByLabel(en.tg_consent_label).check();
  await expect(linkButton).toBeEnabled();
  await minimal.check();
  await expect(linkButton).toBeEnabled();

  // The link request carries the picked level.
  const requested = page.waitForRequest(
    (request) => request.url().endsWith("/api/channels/telegram/link") && request.method() === "POST"
  );
  await linkButton.click();
  expect((await requested).postDataJSON()).toEqual({ consentVersion: expect.any(String), detail: "minimal" });
  const url = page.getByLabel(en.tg_link_label, { exact: true });
  await expect(url).toHaveValue(/^https:\/\/t\.me\/fake_ea_bot\?start=[A-Za-z0-9_-]{43}$/);
  const token = (await url.inputValue()).split("start=")[1];
  const chatId = projectOf() === "mobile" ? 5550111 : 5550112;
  await createFakeTelegramClient(E2E_TELEGRAM_URL).send(`/start ${token}`, { chatId });
  await expect(page.getByText(/Linked since/)).toBeVisible({ timeout: 10_000 });

  const linked = page.locator("[data-section=telegram-detail-linked]");
  await expect(linked.locator("[data-detail=minimal]")).toHaveText(en.tgd_minimal_short);

  // Change to full: the dialog asks for the tick again.
  await linked.getByRole("button", { name: en.tgd_change }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(en.tgd_change_title)).toBeVisible();
  await dialog.getByRole("radio", { name: en.tgd_full_option }).check();
  const save = dialog.getByRole("button", { name: en.save });
  await expect(save).toBeDisabled();
  await dialog.getByLabel(en.tg_consent_label).check();
  await expect(save).toBeEnabled();
  await expectNoA11yViolations(page, { include: "[role=dialog]" });
  await save.click();
  await expect(page.getByText(en.tgd_saved_toast)).toBeVisible();
  await expect(linked.locator("[data-detail=full]")).toHaveText(en.tgd_full_short);

  // Back to minimal: no tick needed; the card shows "Counts and links only".
  await linked.getByRole("button", { name: en.tgd_change }).click();
  await page.getByRole("dialog").getByRole("radio", { name: en.tgd_minimal_option }).check();
  await expect(page.getByRole("dialog").getByLabel(en.tg_consent_label)).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: en.save }).click();
  await expect(linked.locator("[data-detail=minimal]")).toHaveText(en.tgd_minimal_short);
  const state = (await (await page.request.get("/api/channels/telegram")).json()) as { detail: string };
  expect(state.detail).toBe("minimal");
  await expectNoA11yViolations(page, { include: "[data-section=telegram-detail-linked]" });
});

test("the owner locks minimal: the member sees the state, full is disabled in the member's link step", async ({
  page,
  browser,
}) => {
  test.setTimeout(MINUTE_MS);
  setFlag("telegram_minimal", true);
  await page.goto("/settings");
  const card = page.locator("[data-card=telegram-lock]");
  const lockSwitch = card.getByRole("switch", { name: en.tgl_label });
  await expect(lockSwitch).not.toBeChecked();
  await expect(card.getByText(en.tgl_help)).toBeVisible();
  await expectNoA11yViolations(page, { include: "[data-card=telegram-lock]" });

  const member = await asMember(browser);
  try {
    // Not locked: the member can pick full.
    await member.page.goto("/mailboxes");
    const full = member.page.locator("[data-section=telegram-detail]").getByRole("radio", { name: en.tgd_full_option });
    await expect(full).toBeEnabled();

    await lockSwitch.click();
    await expect(page.getByText(en.tgl_on_toast)).toBeVisible();
    await expect(lockSwitch).toBeChecked();
    expect(
      ((await (await page.request.get("/api/organization")).json()) as { telegramMinimalLocked: boolean })
        .telegramMinimalLocked
    ).toBe(true);

    await member.page.reload();
    const section = member.page.locator("[data-section=telegram-detail]");
    await expect(section.getByRole("radio", { name: en.tgd_full_option })).toBeDisabled();
    await expect(section.getByRole("radio", { name: en.tgd_minimal_option })).toBeChecked();
    await expect(section.getByText(en.tgd_locked)).toBeVisible();
    await expectNoA11yViolations(member.page, { include: "[data-section=telegram-detail]" });

    // The member sees the state in Settings and has no switch.
    await member.page.goto("/settings");
    const memberCard = member.page.locator("[data-card=telegram-lock]");
    await expect(memberCard.locator("[data-lock=on]")).toHaveText(en.tgl_state_on);
    // The help speaks to the owner and the General section already says who may change it: the member card shows the state only.
    await expect(memberCard.getByText(en.tgl_help)).toHaveCount(0);
    await expect(memberCard.getByText(en.set_owner_only)).toHaveCount(0);
    await expect(memberCard.getByRole("switch")).toHaveCount(0);
    await expectNoA11yViolations(member.page, { include: "[data-card=telegram-lock]" });

    await lockSwitch.click();
    await expect(page.getByText(en.tgl_off_toast)).toBeVisible();
    await expect(lockSwitch).not.toBeChecked();
  } finally {
    await member.close();
  }
});

test("web_push on: the member sets Urgent to Phone; the patch holds that key only", async ({ browser }) => {
  test.setTimeout(MINUTE_MS);
  setFlag("web_push", true);
  const member = await asMember(browser);
  try {
    const { page } = member;
    await page.goto("/settings");
    const card = page.locator("[data-card=notice-routes]");
    await expect(card).toBeVisible();
    // No chat and no device: the hint, and the default of every group is Telegram.
    await expect(card.getByText(en.nr_none_hint)).toBeVisible();
    const urgent = card.getByLabel(en.nr_group_urgent);
    await expect(urgent).toHaveValue("telegram");
    await expect(urgent.locator("option:checked")).toHaveText("Telegram (default)");
    await expect(card.getByRole("button", { name: en.save })).toBeDisabled();
    await expect(card.getByRole("button", { name: en.nr_use_default })).toBeDisabled();
    await expectNoA11yViolations(page, { include: "[data-card=notice-routes]" });

    const patches: unknown[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/me/notify") && request.method() === "PATCH")
        patches.push(request.postDataJSON());
    });
    await urgent.selectOption("push");
    await card.getByRole("button", { name: en.save }).click();
    await expect(page.getByText(en.nr_saved_toast)).toBeVisible();
    expect(patches).toEqual([{ routes: { urgent: "push" } }]);
    await expect(urgent.locator("option:checked")).toHaveText(en.nr_phone);
    await expect(card.getByLabel(en.nr_group_approvals).locator("option:checked")).toHaveText("Telegram (default)");

    // Back to the defaults: the stored key goes with a null.
    await card.getByRole("button", { name: en.nr_use_default }).click();
    await expect(page.getByText(en.nr_saved_toast).first()).toBeVisible();
    await expect.poll(() => patches.length).toBe(2);
    expect(patches[1]).toEqual({ routes: { urgent: null } });
    await expect(urgent.locator("option:checked")).toHaveText("Telegram (default)");
  } finally {
    await member.close();
  }
});

// The lock changes no stored choice: a member who chose `full` keeps it through a re-link under the lock, and gets it back at the unlock.
test("the lock does not overwrite a stored full: link with full, lock, re-link, unlock gives full again", async ({
  page,
}) => {
  test.setTimeout(150_000);
  setFlag("telegram_minimal", true);
  const chatId = projectOf() === "mobile" ? 5550113 : 5550114;
  const setLock = async (locked: boolean) => {
    const res = await page.request.patch("/api/organization/telegram-lock", { headers, data: { locked } });
    expect(res.ok()).toBe(true);
  };
  const linked = page.locator("[data-section=telegram-detail-linked]");
  const section = page.locator("[data-section=telegram-detail]");
  const completeLink = async () => {
    const url = page.getByLabel(en.tg_link_label, { exact: true });
    await expect(url).toHaveValue(/^https:\/\/t\.me\/fake_ea_bot\?start=[A-Za-z0-9_-]{43}$/);
    const token = (await url.inputValue()).split("start=")[1];
    await createFakeTelegramClient(E2E_TELEGRAM_URL).send(`/start ${token}`, { chatId });
    await expect(page.getByText(/Linked since/)).toBeVisible({ timeout: 10_000 });
  };

  // 1. Link with full.
  await page.goto("/mailboxes");
  await section.getByRole("radio", { name: en.tgd_full_option }).check();
  await page.getByLabel(en.tg_consent_label).check();
  await page.getByRole("button", { name: en.tg_link }).click();
  await completeLink();
  await expect(linked.locator("[data-detail=full]")).toHaveText(en.tgd_full_short);

  // 2. The lock: the card shows what Telegram gets now (minimal) and says that the choice returns; the dialog cannot save a change.
  await setLock(true);
  await page.reload();
  await expect(linked.locator("[data-detail=minimal]")).toHaveText(en.tgd_minimal_short);
  await expect(linked.getByText(en.tgd_locked_now)).toBeVisible();
  await linked.getByRole("button", { name: en.tgd_change }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", { name: en.tgd_full_option })).toBeDisabled();
  await expect(dialog.getByRole("radio", { name: en.tgd_minimal_option })).toBeChecked();
  await expect(dialog.getByRole("button", { name: en.save })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(((await (await page.request.get("/api/channels/telegram")).json()) as { detail: string }).detail).toBe("full");

  // 3. Unlock, unlink, pick full in the link step, then the lock arrives: the step follows it (the poll runs every 30 seconds).
  await setLock(false);
  await page.reload();
  await page.getByRole("button", { name: en.tg_unlink }).click();
  await page.getByRole("dialog").getByRole("button", { name: en.tg_unlink }).click();
  await expect(page.getByText(en.tg_unlinked_toast)).toBeVisible();
  await expect(section.getByRole("radio", { name: en.tgd_full_option })).toBeChecked();
  await section.getByRole("radio", { name: en.tgd_minimal_option }).check();
  await section.getByRole("radio", { name: en.tgd_full_option }).check();
  await setLock(true);
  await expect(section.getByRole("radio", { name: en.tgd_full_option })).toBeDisabled({ timeout: 45_000 });
  await expect(section.getByRole("radio", { name: en.tgd_minimal_option })).toBeChecked();
  await expect(section.getByText(en.tgd_locked)).toBeVisible();

  // 4. Link under the lock: the request carries no detail, the stored full stays, and the unlock gives it back.
  await page.getByLabel(en.tg_consent_label).check();
  const requested = page.waitForRequest(
    (request) => request.url().endsWith("/api/channels/telegram/link") && request.method() === "POST"
  );
  await page.getByRole("button", { name: en.tg_link }).click();
  expect((await requested).postDataJSON()).toEqual({ consentVersion: expect.any(String) });
  await completeLink();
  await expect(linked.locator("[data-detail=minimal]")).toHaveText(en.tgd_minimal_short);
  expect(((await (await page.request.get("/api/channels/telegram")).json()) as { detail: string }).detail).toBe("full");
  await setLock(false);
  await page.reload();
  await expect(linked.locator("[data-detail=full]")).toHaveText(en.tgd_full_short);
});

test("a suspended organization: the lock switch is disabled for the owner", async ({ browser }) => {
  const { pausedOwner } = readSeed();
  setFlag("telegram_minimal", true, pausedOwner.orgId);
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": nextAddress(projectOf() === "mobile" ? 420 : 520) },
  });
  try {
    const page = await context.newPage();
    await signInAs(page, pausedOwner);
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.goto("/settings");
    const card = page.locator("[data-card=telegram-lock]");
    await expect(card.getByRole("switch", { name: en.tgl_label })).toBeDisabled();
    await expectNoA11yViolations(page, { include: "[data-card=telegram-lock]" });
  } finally {
    await context.close();
    setFlag("telegram_minimal", false, pausedOwner.orgId);
  }
});
