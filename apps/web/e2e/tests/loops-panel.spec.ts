import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { E2E_LOOPS_SUBJECTS } from "../../../server/src/scripts/e2e-seed-args";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";
import { sheetDir } from "../ui-sheet/dir";

// The loops organization of the project (see `e2e-seed.ts`, `e2e-loops-rows.ts`): the flags `open_loops`,
// `delegate_button`, `delegation_pages`, `sent_sync` and `approvals_page` are on; one active delegate (Anna Nowak); a mailbox in assist mode with drafts
// on that tracks Sent; three triaged mails (needs reply, unsure, info); the owner is linked to Telegram with a consent of an old
// version; a member. The tests change this organization (a delegation, a wait, a consent), so they run in this order. The seed
// makes the organization new for each run.
test.describe.configure({ mode: "serial" });

const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().loopsOrgs[project()];

// A block of client addresses per project (the login rate limit counts per address): away from the blocks of the other specs.
async function startSession(context: BrowserContext, page: Page, user: { email: string; password: string }) {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(project() === "mobile" ? 50 : 150) });
  const errors = await cspErrors(page);
  await signInAs(page, user);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return errors;
}

// Saves the loops card in both schemes and both languages under `<UI_SHEET_DIR>/settings-mailbox/`, for the look next to the mockup. The page
// returns to English and the light scheme.
async function saveCardPictures(page: Page, card: Locator, state: "tracking-on" | "tracking-off"): Promise<void> {
  const dir = join(sheetDir(), "settings-mailbox");
  mkdirSync(dir, { recursive: true });
  for (const locale of ["en", "pl"] as const) {
    await page.evaluate((value) => localStorage.setItem("ea.locale", value), locale);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(card).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await card.screenshot({
        path: join(dir, `loops-${state}-${project() === "mobile" ? "phone" : "desktop"}-${scheme}-${locale}.png`),
        animations: "disabled",
      });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => localStorage.setItem("ea.locale", "en"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
}

const rowOf = (page: Page, subject: string) => page.locator("li[data-email-id]").filter({ hasText: subject });
const delegateButton = (scope: Page | ReturnType<typeof rowOf>) =>
  scope.getByRole("button", { name: en.dla_button, exact: true });

test("T5: an owner delegates a needs-reply row: the dialog, a pick, the success text with the approval link", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/activity");
  const reply = rowOf(page, E2E_LOOPS_SUBJECTS.reply);
  await expect(reply).toBeVisible();
  // The unsure row has the action too; the info row has none (the Telegram rule: urgent, needs reply, unsure).
  await expect(delegateButton(rowOf(page, E2E_LOOPS_SUBJECTS.unsure))).toBeVisible();
  await expect(delegateButton(rowOf(page, E2E_LOOPS_SUBJECTS.newsletter))).toHaveCount(0);

  await delegateButton(reply).click();
  const dialog = page.getByRole("dialog", { name: en.dla_title });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: en.dla_submit, exact: true })).toBeDisabled();
  // The dialog open.
  await expectNoA11yViolations(page);

  await dialog.getByRole("combobox", { name: en.dla_select_label, exact: true }).click();
  const option = page.getByRole("option", { name: /Anna Nowak/ });
  // The address stands under the name.
  await expect(option).toContainText("anna@example.com");
  await option.click();
  await dialog.getByRole("button", { name: en.dla_submit, exact: true }).click();

  const result = dialog.getByRole("status");
  await expect(result).toContainText(en.dla_done);
  await expect(result.getByRole("link", { name: en.dla_done_link })).toHaveAttribute(
    "href",
    /^\/approvals\?id=[0-9a-f-]{36}$/
  );
  // The mail has a delegation now: after the dialog closes the list refreshes and the row has no action.
  await dialog.getByRole("button", { name: en.cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(delegateButton(reply)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("T6: a member sees no Delegate action", async ({ context, page }) => {
  const errors = await startSession(context, page, org().member);
  await page.goto("/activity");
  await expect(rowOf(page, E2E_LOOPS_SUBJECTS.unsure)).toBeVisible();
  await expect(rowOf(page, E2E_LOOPS_SUBJECTS.newsletter)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(delegateButton(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("T7: the wait select set to 5 is saved after a reload; the switch is saved too", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/settings");
  const card = page.locator("[data-card=loops]");
  await expect(card).toBeVisible();
  await expect(card.getByText(en.lset_wait_help)).toBeVisible();
  await expect(card.getByText(en.lset_auto_help)).toBeVisible();
  // Sent tracking is on: no hint line, both controls work. The default wait is 3 working days.
  await expect(card.getByText(en.lset_needs_sent)).toHaveCount(0);
  const wait = card.getByLabel(en.lset_wait_label);
  const auto = card.getByRole("switch", { name: en.lset_auto_label });
  await expect(wait).toHaveValue("3");
  await expect(auto).not.toBeChecked();
  // The settings page.
  await expectNoA11yViolations(page);

  await wait.selectOption("5");
  await expect(page.getByText(en.lset_wait_toast)).toBeVisible();
  await auto.click();
  await expect(page.getByText(en.lset_auto_on_toast)).toBeVisible();

  await page.reload();
  await expect(card.getByLabel(en.lset_wait_label)).toHaveValue("5");
  await expect(card.getByRole("switch", { name: en.lset_auto_label })).toBeChecked();
  await saveCardPictures(page, card, "tracking-on");
  expect(errors).toEqual([]);
});

test("T8: the Confirm button of the new Telegram terms is gone after the tap", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/mailboxes");
  const terms = page.getByRole("region", { name: en.tgc_title });
  await expect(terms).toBeVisible();
  await expect(terms).toContainText(en.tg_consent_text.slice(0, 80));
  await terms.getByRole("button", { name: en.tgc_confirm, exact: true }).click();
  await expect(page.getByText(en.tgc_confirmed_toast)).toBeVisible();
  await expect(page.getByRole("region", { name: en.tgc_title })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/^Linked since /)).toBeVisible();
  await expect(page.getByRole("region", { name: en.tgc_title })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("T9: with Track my sent mail off, the loops card says so and both controls are disabled", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/settings");
  const card = page.locator("[data-card=loops]");
  const wait = card.getByLabel(en.lset_wait_label);
  const auto = card.getByRole("switch", { name: en.lset_auto_label });
  await expect(wait).toBeEnabled();
  await expect(auto).toBeEnabled();

  await page.locator("[data-card=sent]").getByRole("switch", { name: en.sent_switch, exact: true }).click();
  await expect(page.getByText(en.sent_off_toast)).toBeVisible();
  await expect(card.getByText(en.lset_needs_sent)).toBeVisible();
  await expect(wait).toBeDisabled();
  await expect(auto).toBeDisabled();
  // The help lines stay attached to the controls.
  await expect(wait).toHaveAccessibleDescription(en.lset_wait_help);
  await expect(auto).toHaveAccessibleDescription(en.lset_auto_help);
  await expectNoA11yViolations(page);

  await saveCardPictures(page, card, "tracking-off");
  expect(errors).toEqual([]);
});
