import { expect, test } from "@playwright/test";
import { createFakeTelegramClient } from "../../../../tools/fake-telegram/src/driver";

import { en } from "../../src/i18n/en";
import { E2E_TELEGRAM_URL } from "../env";
import { cleanUpOrg, connectGreenMail, cspErrors, nextAddress, signIn } from "../helpers";
import { readSeed } from "../seed";

test.describe.configure({ mode: "serial" });

let errors: string[] = [];

// The S5a blocks are 10 and 110, the mailboxes spec 40 and 140; this spec uses 70 and 170.
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
  test.setTimeout(60_000);
  const mobile = testInfo.project.name === "mobile";
  const chatId = mobile ? 5550101 : 5550102;

  // The other project may have kept the mode before, and the audit row cannot be deleted.
  const me = (await (await page.request.get("/api/me")).json()) as { onboarding: { mode: boolean } };
  const modeKept = me.onboarding.mode;

  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByText(en.ob_item_open, { exact: true })).toHaveCount(modeKept ? 3 : 4);
  if (modeKept) await expect(page.getByText(en.ob_mode_done, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: en.mb_connect }).click();
  await expect(page).toHaveURL(/\/mailboxes/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await connectGreenMail(page, testInfo.project.name);

  await page.goto("/onboarding");
  await expect(page.getByText(en.ob_mailbox_done_one)).toBeVisible();

  await page.getByRole("button", { name: en.tg_link }).click();
  const url = page.getByLabel(en.tg_link_label, { exact: true });
  await expect(url).toHaveValue(/^https:\/\/t\.me\/fake_ea_bot\?start=[A-Za-z0-9_-]{43}$/);
  const token = (await url.inputValue()).split("start=")[1];
  await createFakeTelegramClient(E2E_TELEGRAM_URL).send(`/start ${token}`, { chatId });
  await expect(page.getByText(/Linked since/)).toBeVisible({ timeout: 10_000 });

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
