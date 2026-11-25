import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { createFakeTelegramClient } from "../../../../tools/fake-telegram/src/driver";

import { en, enPlurals } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
import { expectNoA11yViolations } from "../a11y";
import { E2E_TELEGRAM_URL } from "../env";
import { cleanUpOrg, connectGreenMail, cspErrors, nextAddress, signIn } from "../helpers";
import { readSeed } from "../seed";
import { sheetDir } from "../ui-sheet/dir";
import { MINUTE_MS } from "@ea/core";

test.describe.configure({ mode: "serial" });

let errors: string[] = [];

// The earlier blocks are 10 and 110, the mailboxes spec 40 and 140; this spec uses 70 and 170.
test.beforeEach(async ({ context, page }, testInfo) => {
  const base = testInfo.project.name === "mobile" ? 70 : 170;
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

test("from open to done and back", async ({ page }, testInfo) => {
  test.setTimeout(MINUTE_MS);
  const mobile = testInfo.project.name === "mobile";
  const chatId = mobile ? 5550101 : 5550102;

  // The other project may have kept the mode before, and the audit row cannot be deleted.
  const me = (await (await page.request.get("/api/me")).json()) as { onboarding: { mode: boolean } };
  const modeKept = me.onboarding.mode;

  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByText(en.ob_item_open, { exact: true })).toHaveCount(modeKept ? 3 : 4);
  if (modeKept) await expect(page.getByText(en.ob_mode_done, { exact: true })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.getByRole("link", { name: en.mb_connect }).click();
  await expect(page).toHaveURL(/\/mailboxes/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await connectGreenMail(page, testInfo.project.name);

  await page.goto("/onboarding");
  await expect(page.getByText(enPlurals.ob_mailbox_done.one)).toBeVisible();

  const linkButton = page.getByRole("button", { name: en.tg_link });
  const linkTelegram = async () => {
    await page.getByLabel(en.tg_consent_label).check();
    await expect(linkButton).toBeEnabled();
    await linkButton.click();
    const url = page.getByLabel(en.tg_link_label, { exact: true });
    await expect(url).toHaveValue(/^https:\/\/t\.me\/fake_ea_bot\?start=[A-Za-z0-9_-]{43}$/);
    const token = (await url.inputValue()).split("start=")[1];
    await createFakeTelegramClient(E2E_TELEGRAM_URL).send(`/start ${token}`, { chatId });
    await expect(page.getByText(/Linked since/)).toBeVisible({ timeout: 10_000 });
  };

  await expect(linkButton).toBeDisabled();
  await linkTelegram();

  // The tick does not outlive the link: after an unlink on the same page, a new link needs a new tick.
  await page.getByRole("button", { name: en.tg_unlink }).click();
  await page.getByRole("dialog").getByRole("button", { name: en.tg_unlink }).click();
  await expect(page.getByText(en.tg_unlinked_toast)).toBeVisible();
  await expect(page.getByLabel(en.tg_consent_label)).not.toBeChecked();
  await expect(linkButton).toBeDisabled();
  await linkTelegram();

  if (!modeKept) {
    await page.getByRole("button", { name: en.ob_keep_shadow }).click();
    await expect(page.getByText(en.ob_mode_done, { exact: true })).toBeVisible();
  }
  await expect(page.getByText(en.ob_all_set)).toBeVisible();

  if (mobile) {
    await page.getByRole("button", { name: en.menu_open }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText(readSeed().owner.email);
    await expect(sheet.getByText(en.nav_onboarding)).toHaveCount(0);
    await page.keyboard.press("Escape");
  } else {
    await expect(page.getByRole("navigation", { name: en.nav_main }).getByText(en.nav_onboarding)).toHaveCount(0);
  }

  await page.goto("/");
  await expect(page).toHaveURL(/\/activity$/);

  await page.goto("/mailboxes");
  await page.getByRole("button", { name: en.tg_unlink }).click();
  await page.getByRole("dialog").getByRole("button", { name: en.tg_unlink }).click();
  await expect(page.getByText(en.tg_unlinked_toast)).toBeVisible();

  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
});

interface MeAnswer {
  role: string;
  user: Record<string, unknown>;
  onboarding: Record<string, unknown>;
}

// The answer of `/api/me` with a change. The mode step may be done already (an audit row stays), so a test of the open step sets it open.
async function changeMe(page: Page, change: (me: MeAnswer) => MeAnswer): Promise<void> {
  await page.route("**/api/me", async (route) => {
    const me = (await (await route.fetch()).json()) as MeAnswer;
    await route.fulfill({ json: change(me) });
  });
}

const modeOpen = (me: MeAnswer): MeAnswer => ({ ...me, onboarding: { ...me.onboarding, mode: false, trust: false } });

test("the mode cards explain both modes and a member sees no button", async ({ page }) => {
  await changeMe(page, (me) => ({ ...modeOpen(me), role: "assistant" }));
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { level: 3, name: en.mode_shadow })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: en.mode_assist })).toBeVisible();
  await expect(page.getByText(en.ob_mode_assistant, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: en.ob_keep_shadow })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.ob_use_assist })).toHaveCount(0);
  await expect(page.getByRole("link", { name: en.ob_open_settings })).toHaveCount(0);
});

test("a tap on Use assist opens the mode dialog; Cancel sends no mode call; pictures go to the sheet folder", async ({
  page,
}, testInfo) => {
  test.setTimeout(MINUTE_MS);
  let panelLocale: "en" | "pl" = "en";
  await changeMe(page, (me) => ({ ...modeOpen(me), user: { ...me.user, locale: panelLocale } }));
  const modeCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/mode")) modeCalls.push(`${request.method()} ${request.url()}`);
  });
  const folder = join(sheetDir(), "f170-06");
  mkdirSync(folder, { recursive: true });

  await page.goto("/onboarding");
  await expect(page.getByText(en.ob_mode_need_mailbox, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: en.ob_use_assist })).toHaveCount(0);

  await page.goto("/mailboxes?connect=1");
  await expect(page.getByRole("dialog")).toBeVisible();
  await connectGreenMail(page, testInfo.project.name);

  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { level: 1, name: en.title_onboarding })).toBeVisible();
  const keep = page.getByRole("button", { name: en.ob_keep_shadow });
  await expect(keep).toBeEnabled();
  await expect(page.getByRole("link", { name: en.ob_open_settings })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('[data-card="progress"]')).toBeVisible();
  await expectNoA11yViolations(page);

  const open = page.getByRole("button", { name: en.ob_use_assist });
  await open.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: en.assist_title })).toBeVisible();
  await expectNoA11yViolations(page, { include: '[role="dialog"]' });
  await page.screenshot({
    path: join(folder, `onboarding-assist-dialog-${testInfo.project.name}-light-en.png`),
    animations: "disabled",
  });
  await dialog.getByRole("button", { name: en.cancel }).click();
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeEnabled();
  await expect(keep).toBeVisible();
  expect(modeCalls).toEqual([]);

  for (const [locale, texts] of [
    ["en", en],
    ["pl", pl],
  ] as const) {
    panelLocale = locale;
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: texts.title_onboarding })).toBeVisible();
    await expect(page.getByRole("button", { name: texts.ob_use_assist })).toBeEnabled();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({
        path: join(folder, `onboarding-mode-cards-${testInfo.project.name}-${scheme}-${locale}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  expect(modeCalls).toEqual([]);
});
