import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { t } from "../../src/i18n";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The trust organization of the project (see `e2e-seed.ts`): the flag `trust_ladder` is on, the server reads the gate fixture folder
// (`apps/web/e2e/gate-fixture/`: `info`, `notification` and `spam` all `go`, 99.1% on 200 cases), one mailbox has a done history check
// (`spam` fails: 6 of 60) and an active trip on `info`. The tests of a project run in this order: the lines, the keyboard, the refused
// switch (cancel, then confirm: `spam` stays on), the member, and the organization without the flag.
test.describe.configure({ mode: "serial" });

const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().trustOrgs[project()];

// Every test signs in once, from its own client address: the login rate limit counts per address. Documentation range 192.0.2.0/24,
// a block per project, away from the blocks of the urgency specs.
let signIns = 0;
async function startSession(context: BrowserContext, page: Page, user: { email: string; password: string }) {
  signIns += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `192.0.2.${(project() === "mobile" ? 90 : 160) + signIns}`,
  });
  const errors = await cspErrors(page);
  await signInAs(page, user);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return errors;
}

const card = (page: Page) => page.locator("[data-card=categories]");
const rowOf = (page: Page, category: "info" | "notification" | "spam") =>
  card(page)
    .locator("[data-slot=row]")
    .filter({ has: page.locator(`[data-slot=category-pill][data-category=${category}]`) });
const autoSwitch = (page: Page, category: "info" | "notification" | "spam") =>
  page.getByRole("switch", { name: t("cat_auto_label", { category: en[`cat_${category}`] }), exact: true });

async function openCard(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(card(page)).toBeVisible();
  // The lines come with the trust view, a moment after the switches.
  await expect(rowOf(page, "notification").getByText(en.trust_mail_pass)).toBeVisible();
}

const proof = t("trust_proof_go", { percent: "99.1", cases: 200 });
const spamLine = t("trust_mail_fail", { moved: 6, acted: 60 });

async function expectLines(page: Page): Promise<void> {
  await expect(rowOf(page, "notification").getByText(proof, { exact: true })).toBeVisible();
  await expect(rowOf(page, "notification").getByText(en.trust_mail_pass, { exact: true })).toBeVisible();
  await expect(rowOf(page, "spam").getByText(proof, { exact: true })).toBeVisible();
  await expect(rowOf(page, "spam").getByText(spamLine, { exact: true })).toBeVisible();
  await expect(rowOf(page, "info").getByText(en.trust_paused_corrections, { exact: true })).toBeVisible();
  await expect(card(page).getByRole("link", { name: en.trust_report_link })).toHaveAttribute(
    "href",
    `/report?mailbox=${org().mailbox.id}`
  );
}

test("T1: the card shows the proof, the history and the pause per category, and passes axe", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await openCard(page);
  await expectLines(page);
  // One pill per category; the rows carry no emoji.
  await expect(card(page).locator("[data-slot=category-pill]")).toHaveCount(5);
  const rowTexts = await card(page).locator("[data-slot=row]").allTextContents();
  expect(rowTexts.filter((text) => /\p{Extended_Pictographic}/u.test(text))).toEqual([]);
  // The pause line is the red one (the destructive text colour); the proof line is not.
  await expect(rowOf(page, "info").getByText(en.trust_paused_corrections)).toHaveClass(/text-destructive/);
  await expect(rowOf(page, "notification").getByText(proof)).not.toHaveClass(/text-destructive/);
  // A category that is not paused has no pause line; the ratings line is hidden under 30 rated mails.
  await expect(rowOf(page, "notification").getByText(/^Paused/)).toHaveCount(0);
  await expect(card(page).getByText(en.gate_too_few.slice(0, 20))).toHaveCount(0);
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("T2: the keyboard reaches every switch of the card in order", async ({ context, page }) => {
  await startSession(context, page, org().owner);
  await openCard(page);
  const names: string[] = [];
  // Start before the card: the first control of the card is the first switch on the page after the mode card.
  await card(page).scrollIntoViewIfNeeded();
  await page.locator("body").press("Home");
  for (let step = 0; step < 80 && names.length < 5; step += 1) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => {
      const el = document.activeElement;
      const inCard = el?.closest("[data-card=categories]") !== null && el?.getAttribute("role") === "switch";
      return inCard ? (el?.getAttribute("aria-label") ?? "") : "";
    });
    if (label !== "") names.push(label);
  }
  expect(names).toEqual(
    ["urgent", "needs_reply", "info", "notification", "spam"].map((category) =>
      t("cat_auto_label", { category: en[`cat_${category}` as keyof typeof en] })
    )
  );
});

// Presses Tab until the focus is on the button, inside the dialog; fails after a few steps.
async function tabTo(page: Page, button: Locator): Promise<void> {
  for (let step = 0; step < 6; step += 1) {
    if (await button.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(button).toBeFocused();
}

test("T3: a refused switch opens the dialog with the block lines; cancel keeps it off, confirm turns it on", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await openCard(page);
  // Open it with the keyboard: focus the switch and press Space.
  await autoSwitch(page, "spam").focus();
  await page.keyboard.press("Space");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(en.anyway_title)).toBeVisible();
  await expect(dialog.getByText(en.trust_anyway_intro)).toBeVisible();
  await expect(dialog.getByText(en.trust_block_history_fail)).toBeVisible();
  await expect(dialog.getByText(/would hide mail you needed/)).toBeVisible();
  // The gate text of the real labels is not shown next to the blocks.
  await expect(dialog.getByText(/Passed|Not passed|Not enough rated mails/)).toHaveCount(0);
  await expectNoA11yViolations(page);

  // The keyboard reaches both buttons of the dialog.
  const cancel = dialog.getByRole("button", { name: en.cancel });
  const confirm = dialog.getByRole("button", { name: en.anyway_submit });
  await tabTo(page, cancel);
  await tabTo(page, confirm);
  await cancel.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(autoSwitch(page, "spam")).not.toBeChecked();

  await autoSwitch(page, "spam").click();
  await expect(dialog.getByText(en.trust_block_history_fail)).toBeVisible();
  await confirm.click();
  await expect(page.getByText(t("auto_on_toast", { category: en.cat_spam }))).toBeVisible();
  await expect(autoSwitch(page, "spam")).toBeChecked();
  // The card reads the view again: the proof and the history line stay.
  await expect(rowOf(page, "spam").getByText(spamLine)).toBeVisible();
  // A reload shows the same: the switch is on in the settings and in the view.
  await page.reload();
  await expect(autoSwitch(page, "spam")).toBeChecked();
  expect(errors).toEqual([]);
});

test("T4: a member sees the same lines and every switch is disabled", async ({ context, page }) => {
  await startSession(context, page, org().member);
  await openCard(page);
  await expectLines(page);
  for (const category of ["info", "notification", "spam"] as const) {
    await expect(autoSwitch(page, category)).toBeDisabled();
  }
  await expectNoA11yViolations(page);
});

test("T5: an organization without the flag has no evidence line and asks for no trust view", async ({
  context,
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  const off = readSeed().urgencyOrgs[project()];
  const errors = await startSession(context, page, off.owner);
  await page.goto("/settings");
  await expect(card(page)).toBeVisible();
  await expect(autoSwitch(page, "info")).toBeVisible();
  // The card shows the old ratings line; give the page time to ask for the view, which it must not do.
  await expect(
    card(page)
      .getByText(/Not enough rated mails/)
      .first()
  ).toBeVisible();
  await page.waitForTimeout(500);
  await expect(card(page).locator("[data-line]")).toHaveCount(0);
  await expect(card(page).getByText(/^(Proof:|Your mail:|Paused)/)).toHaveCount(0);
  await expect(card(page).getByRole("link", { name: en.trust_report_link })).toHaveCount(0);
  expect(requests.filter((path) => path.startsWith("/api/trust"))).toEqual([]);
  expect(errors).toEqual([]);
});
