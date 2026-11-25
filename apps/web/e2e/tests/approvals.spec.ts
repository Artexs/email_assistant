import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

import {
  E2E_APPROVALS,
  E2E_APPROVALS_COUNT,
  E2E_APPROVALS_WAITING,
  E2E_QUEUE,
  E2E_QUEUE_WAITING,
} from "../../../server/src/scripts/e2e-seed-args";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { E2E_BASE_URL } from "../env";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";
import { MINUTE_MS } from "@ea/core";

// The approvals organization of the project (see `e2e-approvals-rows.ts`): a waiting send to Anna Nowak (the `waiting` send), a send that
// the owner approved and SEND_SCOPE=self holds (Piotr Lis is not on the list of the e2e server), a second waiting send (`edit`) and a
// waiting reminder. The tests that decide or edit a send change it, so the tests of a project run in this order: the reads first, then
// the reject of the held send, then the edits of the `waiting` send (conflict, delegate, the dialog under axe, the keyboard path, which
// approves the newest version), then the edit and approve of the `edit` send.
test.describe.configure({ mode: "serial" });

const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().approvalsOrgs[project()];

// Every test signs in once, from its own client address: the login rate limit counts per address. Documentation range 203.0.113.0/24,
// a block per project, away from the `nextAddress` range of the other specs.
let signIns = 0;
async function startSession(context: BrowserContext, page: Page, user: { email: string; password: string }) {
  signIns += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${(project() === "mobile" ? 10 : 110) + signIns}`,
  });
  const errors = await cspErrors(page);
  await signInAs(page, user);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return errors;
}

// The decision buttons turn on a moment after a card shows and fade in; a scan in the fade reads the mixed colour.
async function buttonsReady(page: Page) {
  const yes = page.getByRole("region", { name: en.appr_detail_label }).getByRole("button", {
    name: en.appr_approve,
    exact: true,
  });
  await expect(yes).toBeEnabled();
  await expect(yes).toHaveCSS("opacity", "1");
}

const detailOf = (page: Page) => page.getByRole("region", { name: en.appr_detail_label });
// The list of waiting drafts. A phone shows it in a sheet: "All waiting" opens it first.
const listOf = (page: Page) => page.getByRole("list", { name: en.appr_list_label });
const allWaitingName = en.appr_all_waiting.replace(" ({n})", "");
async function openList(page: Page) {
  if (project() === "mobile") await page.getByRole("button", { name: allWaitingName }).click();
  return listOf(page);
}
// The line of the result (the page moves the focus here after an answer).
const statusOf = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const badgeName = (count: number) => `${en.nav_approvals} ${en.nav_approvals_badge.replace("{n}", `${count}`)}`;

test("T4: with the flag on the nav shows Approvals with the count; with it off there is no item and the page says so", async ({
  browser,
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { level: 1, name: en.title_approvals })).toBeVisible();
  // Three waiting sends (a reminder too); the held one is approved already and does not count.
  await expect(page.getByRole("link", { name: badgeName(E2E_APPROVALS_WAITING) })).toBeVisible();
  await expect((await openList(page)).getByRole("link")).toHaveCount(E2E_APPROVALS_COUNT);
  expect(errors).toEqual([]);

  // The main organization has the flag off: no item, and the page shows the flag-off text. A second browser context, its own address.
  const main = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(project() === "mobile" ? 60 : 160) + signIns}` },
    ...(project() === "mobile"
      ? { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true }
      : { viewport: { width: 1280, height: 800 } }),
  });
  try {
    const offPage = await main.newPage();
    const offErrors = await cspErrors(offPage);
    await signInAs(offPage, readSeed().owner);
    await offPage.waitForURL((url) => !url.pathname.startsWith("/login"));
    await offPage.goto("/approvals");
    await expect(offPage.getByText(en.appr_off)).toBeVisible();
    await expect(offPage.getByRole("link", { name: en.nav_approvals })).toHaveCount(0);
    expect(offErrors).toEqual([]);
  } finally {
    await main.close();
  }
});

test("T5: the page of a send shows the recipient, the subject, the body, the quote and the external-sender warning", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(`/approvals?id=${org().waitingSendId}`);
  const detail = detailOf(page);
  await expect(detail.getByRole("heading", { level: 2 })).toContainText(
    `${E2E_APPROVALS.waiting.delegateName} <${E2E_APPROVALS.waiting.delegateEmail}>`
  );
  await expect(detail).toContainText(E2E_APPROVALS.waiting.subject);
  await expect(detail.getByRole("heading", { level: 3, name: en.appr_draft })).toBeVisible();
  await expect(detail).toContainText(E2E_APPROVALS.waiting.task);
  // The quote is a closed disclosure; its text is in the page.
  await expect(detail.locator("summary", { hasText: en.appr_quote })).toBeVisible();
  await expect(detail).toContainText(E2E_APPROVALS.waiting.body);
  await expect(detail).toContainText(en.appr_external);
  await expect(detail).toContainText(en.appr_send_note);
  await expect(detail.getByRole("button", { name: en.appr_approve, exact: true })).toBeEnabled();
  await expect(detail.getByRole("button", { name: en.appr_reject, exact: true })).toBeEnabled();
  await expect(detail.getByRole("button", { name: en.appr_edit, exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("T8: a member sees the list and the draft and has no Approve or Reject button", async ({ context, page }) => {
  const errors = await startSession(context, page, org().member);
  await page.goto("/approvals");
  await expect((await openList(page)).getByRole("link")).toHaveCount(E2E_APPROVALS_COUNT);
  await page.goto(`/approvals?id=${org().waitingSendId}`);
  await expect(detailOf(page)).toContainText(E2E_APPROVALS.waiting.body);
  await expect(detailOf(page).getByText(en.owner_only)).toBeVisible();
  await expect(page.getByRole("button", { name: en.appr_approve, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.appr_reject, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.appr_edit, exact: true })).toHaveCount(0);
  // The server refuses a member as well (the page is no gate).
  const refused = await page.request.post(`/api/approvals/${org().waitingSendId}/approve`, {
    data: {},
    headers: { origin: new URL(page.url()).origin },
  });
  expect(refused.status()).toBe(403);
  expect(errors).toEqual([]);
});

test("T9: the list and the open draft have no axe violation", async ({ context, page }) => {
  await startSession(context, page, org().owner);
  await page.goto("/approvals");
  await buttonsReady(page);
  await expectNoA11yViolations(page);

  await page.goto(`/approvals?id=${org().waitingSendId}`);
  await buttonsReady(page);
  await expectNoA11yViolations(page);
});

test("T10: the phone tab bar holds 5 items and the menu holds Stats; the desktop sidebar holds all 6", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  await page.goto("/approvals");
  const nav = page.getByRole("navigation", { name: en.nav_main });
  await expect(nav.getByRole("link", { name: en.nav_activity })).toBeVisible();
  if (project() === "mobile") {
    await expect(nav.getByRole("link")).toHaveCount(5);
    await expect(nav.getByRole("link", { name: en.nav_stats })).toHaveCount(0);
    await page.getByRole("button", { name: en.menu_open }).click();
    const menu = page.getByRole("dialog");
    await expect(menu.getByRole("link", { name: en.nav_stats })).toBeVisible();
    await expectNoA11yViolations(page);
  } else {
    // The sidebar holds every item (the onboarding link comes with them while the owner has not finished it).
    for (const name of [
      en.nav_activity,
      en.nav_approvals,
      en.nav_mailboxes,
      en.nav_settings,
      en.nav_rules,
      en.nav_stats,
    ]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
  }
});

test("T7: Reject on the held send asks for a reason; Wrong person is saved; the focus and axe hold after the answer", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(`/approvals?id=${org().heldSendId}`);
  const detail = detailOf(page);
  // The send is approved and held by the scope: it can only be rejected, and it cannot be edited.
  await expect(detail).toContainText(en.appr_held_scope);
  await expect(detail.getByRole("button", { name: en.appr_approve, exact: true })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: en.appr_edit, exact: true })).toHaveCount(0);
  await detail.getByRole("button", { name: en.appr_reject, exact: true }).click();
  await expect(page.getByText(en.appr_done_rejected)).toBeVisible();
  // The Reject button is gone: the focus is on the line of the result, not on the page start.
  await expect(statusOf(page, en.appr_done_rejected)).toBeFocused();
  // Axe with the notice shown and the reason select closed, then open.
  await expect(detail.getByRole("combobox", { name: en.appr_reason_label })).toBeVisible();
  await expectNoA11yViolations(page);

  await detail.getByRole("combobox", { name: en.appr_reason_label }).click();
  await expect(page.getByRole("option", { name: en.appr_reason_wrong_person })).toBeVisible();
  // While the select is open, Radix hides the rest of the page with aria-hidden and leaves its buttons focusable, so axe reports
  // `aria-hidden-focus` for the page behind (a known effect of the Radix select, not of this page). Only the open list is checked.
  await expectNoA11yViolations(page, { include: '[role="listbox"]' });
  await page.getByRole("option", { name: en.appr_reason_wrong_person }).click();
  await expect(page.getByText(en.appr_reason_saved)).toBeVisible();
  // The select is gone as well: the focus is on the saved line.
  await expect(page.getByText(en.appr_reason_saved)).toBeFocused();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expectNoA11yViolations(page);
  // The rejected send is no longer in the list after a reload.
  await page.goto("/approvals");
  await expect((await openList(page)).getByRole("link")).toHaveCount(E2E_APPROVALS_COUNT - 1);
  expect(errors).toEqual([]);
});

test("S13-T6: a reminder has no Edit button; Reject and Skip put the focus on the result line", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(`/approvals?id=${org().reminderSendId}`);
  const detail = detailOf(page);
  await expect(detail.getByRole("heading", { level: 2 })).toContainText(
    en.appr_title_reminder.replace(
      "{to}",
      `${E2E_APPROVALS.reminder.delegateName} <${E2E_APPROVALS.reminder.delegateEmail}>`
    )
  );
  await expect(detail.getByRole("button", { name: en.appr_approve, exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: en.appr_reject, exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: en.appr_edit, exact: true })).toHaveCount(0);
  // Reject it and choose Skip: the select is gone, the focus is on the line of the result.
  await detail.getByRole("button", { name: en.appr_reject, exact: true }).click();
  await expect(statusOf(page, en.appr_done_rejected)).toBeFocused();
  await detail.getByRole("combobox", { name: en.appr_reason_label }).click();
  await page.getByRole("option", { name: en.appr_reason_skip }).click();
  await expect(detail.getByRole("combobox", { name: en.appr_reason_label })).toHaveCount(0);
  await expect(statusOf(page, en.appr_done_rejected)).toBeFocused();
  expect(errors).toEqual([]);
});

// A second signed-in browser of the same owner, as the project makes it (own client address: the login rate limit counts per address).
async function secondClient(browser: Browser) {
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    ...(project() === "mobile"
      ? { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true }
      : { viewport: { width: 1280, height: 800 } }),
  });
  const page = await context.newPage();
  await startSession(context, page, org().owner);
  return { context, page };
}

const editDialog = (page: Page) => page.getByRole("dialog", { name: en.appr_edit_title });
// While the dialog asks to discard, its name is the question.
const discardDialog = (page: Page) => page.getByRole("dialog", { name: en.appr_edit_discard_title });
const subjectBox = (page: Page) => editDialog(page).getByRole("textbox", { name: en.appr_subject, exact: true });
const bodyBox = (page: Page) => editDialog(page).getByRole("textbox", { name: en.appr_edit_body, exact: true });
const saveButton = (page: Page) => editDialog(page).getByRole("button", { name: en.save, exact: true });
const savedText = (version: number) => en.appr_edit_saved.replace("{n}", `${version}`);

// The link of a replaced version shows a closed card; "Open the newest version" leads to the draft that can be decided.
async function openNewest(page: Page, id: string) {
  await page.goto(`/approvals?id=${id}`);
  const newest = detailOf(page).getByRole("button", { name: en.appr_open_newest, exact: true });
  const change = detailOf(page).getByRole("button", { name: en.appr_edit, exact: true });
  await expect(newest.or(change)).toBeVisible();
  if (await newest.isVisible()) await newest.click();
  await expect(change).toBeVisible();
}

async function openEditor(page: Page, id: string) {
  await openNewest(page, id);
  await detailOf(page).getByRole("button", { name: en.appr_edit, exact: true }).click();
  await expect(editDialog(page)).toBeVisible();
}

test("S13-T4: a second browser that edits an old version gets the changed text and the button to the new version", async ({
  browser,
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  const second = await secondClient(browser);
  try {
    // Both browsers show version 1 of the send.
    await page.goto(`/approvals?id=${org().waitingSendId}`);
    await second.page.goto(`/approvals?id=${org().waitingSendId}`);
    await expect(detailOf(second.page)).toContainText(E2E_APPROVALS.waiting.subject);

    await detailOf(page).getByRole("button", { name: en.appr_edit, exact: true }).click();
    await subjectBox(page).fill("Budget first");
    await saveButton(page).click();
    await expect(page.getByText(savedText(2))).toBeVisible();

    // The second browser still shows version 1: its save names the old id.
    await detailOf(second.page).getByRole("button", { name: en.appr_edit, exact: true }).click();
    await subjectBox(second.page).fill("Budget second");
    await saveButton(second.page).click();
    await expect(editDialog(second.page).getByText(en.appr_edit_changed)).toBeVisible();
    // The typed text stays in the dialog (the owner may copy it).
    await expect(subjectBox(second.page)).toHaveValue("Budget second");
    await editDialog(second.page).getByRole("button", { name: en.appr_edit_open_new }).click();
    await expect(editDialog(second.page)).toHaveCount(0);
    await expect(detailOf(second.page)).toContainText(en.appr_version.replace("{n}", "2"));
    await expect(detailOf(second.page)).toContainText("Budget first");
    // The new version is open and the focus is on the line of the result (not on the Edit button of the old item).
    await expect(statusOf(second.page, en.appr_changed)).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await second.context.close();
  }
});

test("S13-T5: another delegate with no text change makes a new version for that delegate", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  // The first send was replaced in the test before: its address shows the newest version.
  await openNewest(page, org().waitingSendId);
  await expect(detailOf(page)).toContainText(en.appr_version.replace("{n}", "2"));
  await detailOf(page).getByRole("button", { name: en.appr_edit, exact: true }).click();
  // With no change, Save is off.
  await expect(saveButton(page)).toBeDisabled();
  await editDialog(page).getByRole("combobox", { name: en.appr_edit_delegate }).click();
  await page
    .getByRole("option", { name: `${E2E_APPROVALS.held.delegateName} <${E2E_APPROVALS.held.delegateEmail}>` })
    .click();
  await expect(saveButton(page)).toBeEnabled();
  await saveButton(page).click();
  await expect(page.getByText(savedText(3))).toBeVisible();
  await expect(detailOf(page).getByRole("heading", { level: 2 })).toContainText(
    `${E2E_APPROVALS.held.delegateName} <${E2E_APPROVALS.held.delegateEmail}>`
  );
  expect(errors).toEqual([]);
});

test("S13-T8: the edit dialog and its discard question have no axe violation; the page has none after the save", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  await openEditor(page, org().waitingSendId);
  await expect(subjectBox(page)).toBeFocused();
  await expectNoA11yViolations(page);

  // A typed change: closing asks first. Escape asks; "Keep editing" returns to Subject.
  await subjectBox(page).fill("Budget axe");
  await page.keyboard.press("Escape");
  await expect(discardDialog(page)).toBeVisible();
  await expectNoA11yViolations(page);
  await discardDialog(page).getByRole("button", { name: en.appr_edit_keep }).click();
  await expect(subjectBox(page)).toBeFocused();
  await expect(subjectBox(page)).toHaveValue("Budget axe");

  // An over-long body: the counter and the error state have no violation, Save is off.
  await bodyBox(page).fill("x".repeat(3001));
  await expect(saveButton(page)).toBeDisabled();
  await expectNoA11yViolations(page);

  // Discard closes the dialog and gives the focus back to the Edit button.
  await bodyBox(page).fill("Short text");
  await page.keyboard.press("Escape");
  await discardDialog(page).getByRole("button", { name: en.appr_edit_discard, exact: true }).click();
  await expect(editDialog(page)).toHaveCount(0);
  await expect(detailOf(page).getByRole("button", { name: en.appr_edit, exact: true })).toBeFocused();

  // The page after a save (notice shown, new version open).
  await detailOf(page).getByRole("button", { name: en.appr_edit, exact: true }).click();
  await subjectBox(page).fill("Budget axe saved");
  await saveButton(page).click();
  await expect(page.getByText(savedText(4))).toBeVisible();
  await expect(detailOf(page)).toContainText("Budget axe saved");
  await expectNoA11yViolations(page);
});

// Presses Tab until the element is focused (the other stops on the way are links and buttons of the page). Only the keyboard moves.
async function tabTo(page: Page, target: Locator, max = 40) {
  for (let step = 0; step < max; step += 1) {
    await page.keyboard.press("Tab");
    if ((await target.count()) > 0 && (await target.first().evaluate((el) => el === document.activeElement))) return;
  }
  await expect(target, `Tab did not reach the element in ${max} steps`).toBeFocused();
}

test("S13-T7: the keyboard alone opens a draft, edits it, saves and approves it", async ({ context, page }) => {
  test.skip(project() === "mobile", "the keyboard path runs on the desktop project");
  // The committer of the e2e server runs every 15 seconds (the mailbox copy of the new version).
  test.setTimeout(120_000);
  const errors = await startSession(context, page, org().owner);
  // The page opens the first draft by itself (the newest version of the `waiting` send).
  await page.goto("/approvals");
  const detail = detailOf(page);
  await expect(detail.getByRole("button", { name: en.appr_edit, exact: true })).toBeVisible();

  // Tab reaches Edit; Enter opens the dialog with the focus in Subject.
  await tabTo(page, detail.getByRole("button", { name: en.appr_edit, exact: true }), 80);
  await page.keyboard.press("Enter");
  await expect(editDialog(page)).toBeVisible();
  await expect(subjectBox(page)).toBeFocused();

  // Typing changes the subject. Escape asks to discard; "Keep editing" puts the focus back in Subject.
  await page.keyboard.press("End");
  await page.keyboard.type(" keyboard");
  await expect(subjectBox(page)).toHaveValue(/ keyboard$/);
  await page.keyboard.press("Escape");
  const keep = discardDialog(page).getByRole("button", { name: en.appr_edit_keep });
  await expect(keep).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(subjectBox(page)).toBeFocused();
  await expect(subjectBox(page)).toHaveValue(/ keyboard$/);

  // Tab reaches Save; Enter saves: the dialog closes and the focus is on the line of the result.
  await tabTo(page, saveButton(page));
  await page.keyboard.press("Enter");
  await expect(editDialog(page)).toHaveCount(0);
  await expect(statusOf(page, savedText(5))).toBeFocused();

  // Tab reaches "Yes, send it"; Enter approves. The button is gone afterwards: the focus is on the line of the result.
  const approve = detail.getByRole("button", { name: en.appr_approve, exact: true });
  await expect(approve).toBeVisible();
  await expect(detail).toContainText("keyboard");
  // Approve is off while the committer makes the mailbox copy of the new version; the page turns it on by itself.
  await expect(approve).toBeEnabled({ timeout: MINUTE_MS });
  await tabTo(page, approve);
  await page.keyboard.press("Enter");
  // The newest version goes to the second delegate, whom the e2e server holds back: the result names the hold.
  const result = statusOf(page, /^Approved\./);
  await expect(result).toBeVisible();
  await expect(result).toBeFocused();
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("S13-N1: the draft poll does not close an open dialog when another browser replaces the version", async ({
  browser,
  context,
  page,
}) => {
  test.skip(project() === "mobile", "the race runs on the desktop project");
  test.setTimeout(90_000);
  const errors = await startSession(context, page, org().owner);
  const second = await secondClient(browser);
  try {
    await openEditor(page, org().raceSendId);
    await subjectBox(page).fill("Race v2");
    await saveButton(page).click();
    await expect(page.getByText(savedText(2))).toBeVisible();
    const version2 = new URL(page.url()).searchParams.get("id") ?? "";

    // Version 2 has no mailbox copy yet, so the page polls it. The second browser opens it and types.
    await second.page.goto(`/approvals?id=${version2}`);
    await detailOf(second.page).getByRole("button", { name: en.appr_edit, exact: true }).click();
    await subjectBox(second.page).fill("Typed in the second browser");

    // The first browser replaces version 2 by version 3.
    await detailOf(page).getByRole("button", { name: en.appr_edit, exact: true }).click();
    await subjectBox(page).fill("Race v3");
    await saveButton(page).click();
    await expect(page.getByText(savedText(3))).toBeVisible();

    // Longer than one poll step (5 s): the dialog stays open with the typed text, and the save answers `changed`.
    await second.page.waitForTimeout(7_000);
    await expect(editDialog(second.page)).toHaveCount(1);
    await expect(subjectBox(second.page)).toHaveValue("Typed in the second browser");
    await saveButton(second.page).click();
    await expect(editDialog(second.page).getByText(en.appr_edit_changed)).toBeVisible();
    await expect(subjectBox(second.page)).toHaveValue("Typed in the second browser");
    expect(errors).toEqual([]);
  } finally {
    await second.context.close();
  }
});

test("S13-TG2: a send closed while the dialog is open closes it and the focus is on the result line", async ({
  browser,
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  const second = await secondClient(browser);
  try {
    await openEditor(page, org().closedSendId);
    await subjectBox(page).fill("Closed case typed");
    // The second browser rejects the send.
    await second.page.goto(`/approvals?id=${org().closedSendId}`);
    await detailOf(second.page).getByRole("button", { name: en.appr_reject, exact: true }).click();
    await expect(statusOf(second.page, en.appr_done_rejected)).toBeVisible();

    await saveButton(page).click();
    await expect(editDialog(page)).toHaveCount(0);
    await expect(statusOf(page, en.appr_closed_rejected)).toBeVisible();
    await expect(statusOf(page, en.appr_closed_rejected)).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await second.context.close();
  }
});

test("S13-T3: edit the subject and the body, see version 2, approve it and see it sent", async ({ context, page }) => {
  // The committer of the e2e server runs every 15 seconds and sends through the GreenMail of the dev stack.
  test.setTimeout(120_000);
  const errors = await startSession(context, page, org().owner);
  await openEditor(page, org().editSendId);
  // The text of the draft and the note about the quote and the editing place.
  await expect(editDialog(page)).toContainText(en.appr_edit_hint);
  await expect(editDialog(page)).toContainText(en.appr_edit_quote_note);
  // The subject of a delegation starts with "Fwd: " (the forwarded mail).
  await expect(subjectBox(page)).toHaveValue(new RegExp(`${E2E_APPROVALS.edit.subject}$`));
  await subjectBox(page).fill("Budget 2027");
  await bodyBox(page).fill("Hello Anna, please send the report.");
  await saveButton(page).click();
  await expect(page.getByText(savedText(2))).toBeVisible();
  const detail = detailOf(page);
  await expect(detail).toContainText(en.appr_version.replace("{n}", "2"));
  await expect(detail).toContainText("Budget 2027");
  await expect(detail).toContainText("Hello Anna, please send the report.");
  // A new version is a new request: the old one is not in the list any more (a reminder, the edit and the first send remain or not).
  const sendId = new URL(page.url()).searchParams.get("id") ?? "";
  expect(sendId).not.toBe(org().editSendId);

  // The new version has no copy in the mailbox yet: Approve is off until the committer made it, and the page finds that out by itself
  // (no reload here).
  await expect(detail.getByRole("button", { name: en.appr_approve, exact: true })).toBeEnabled({ timeout: MINUTE_MS });
  await detail.getByRole("button", { name: en.appr_approve, exact: true }).click();
  const approved = statusOf(page, /^(Sending|Sent) to Anna Nowak/);
  await expect(approved).toBeVisible();
  await expect(approved).toBeFocused();
  await expectNoA11yViolations(page);

  // The committer sends it; the link of the draft then shows a closed card with the state.
  await expect(async () => {
    await page.goto(`/approvals?id=${sendId}`);
    await expect(detail).toContainText(en.appr_state_sent, { timeout: 3_000 });
  }).toPass({ timeout: 90_000, intervals: [3_000] });
  expect(errors).toEqual([]);
});

// The queue: the second organization of the project holds five waiting drafts to the delegate that SEND_SCOPE=self admits and a held
// send. The tests below run in this order and use up the drafts: the reads first, then two tests approve one draft each, one rejects a
// draft and replaces another, one rejects the focused draft, and the phone test rejects the last one.
const queue = () => readSeed().queueOrgs[project()];
// The plan of the draft at a place of the list (the list is newest first, the plan oldest first).
const planAt = (place: number) => E2E_QUEUE.drafts[E2E_QUEUE_WAITING - 1 - place];
const stepText = (current: number, total: number) =>
  en.appr_progress.replace("{current}", `${current}`).replace("{total}", `${total}`);
const idOf = (page: Page) => new URL(page.url()).searchParams.get("id") ?? "";
const laterOf = (page: Page) => page.getByRole("button", { name: en.appr_later, exact: true });
const yesOf = (page: Page) => detailOf(page).getByRole("button", { name: en.appr_approve, exact: true });
const noOf = (page: Page) => detailOf(page).getByRole("button", { name: en.appr_reject, exact: true });

async function stateOf(page: Page, id: string): Promise<string> {
  const response = await page.request.get(`/api/approvals/${id}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { state: string }).state;
}

async function decideByRequest(page: Page, id: string, action: "reject") {
  const answer = await page.request.post(`/api/approvals/${id}/${action}`, {
    data: {},
    headers: { origin: new URL(page.url()).origin },
  });
  expect(answer.status()).toBe(200);
}

// Waits for a text with the frame clock, so a click comes in the first frame that shows it.
const textShown = (page: Page, pattern: RegExp) =>
  page.waitForFunction((expected) => expected.test(document.body.innerText), pattern, { polling: "raf" });

test("the link of the third waiting draft opens it first; the link of the held send shows only No", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, queue().owner);
  await page.goto(`/approvals?id=${queue().waitingSendIds[2]}`);
  await expect(detailOf(page)).toContainText(planAt(2).subject);
  await expect(page.getByText(stepText(1, E2E_QUEUE_WAITING))).toBeVisible();

  await page.goto(`/approvals?id=${queue().heldSendId}`);
  await expect(detailOf(page)).toContainText(E2E_QUEUE.held.subject);
  await expect(noOf(page)).toBeEnabled();
  await expect(yesOf(page)).toHaveCount(0);
  await expect(detailOf(page).getByRole("button", { name: en.appr_edit, exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Later shows the next draft with a new link, keeps the count and changes nothing on the server", async ({
  context,
  page,
}) => {
  await startSession(context, page, queue().owner);
  await page.goto("/approvals");
  await expect(detailOf(page)).toContainText(planAt(0).subject);
  const first = idOf(page);
  expect(first).toBe(queue().waitingSendIds[0]);
  await expect(page.getByText(stepText(1, E2E_QUEUE_WAITING))).toBeVisible();

  await laterOf(page).click();
  await expect(detailOf(page)).toContainText(planAt(1).subject);
  expect(idOf(page)).toBe(queue().waitingSendIds[1]);
  await expect(page.getByText(stepText(1, E2E_QUEUE_WAITING))).toBeVisible();
  expect(await stateOf(page, first)).toBe("waiting");
});

test("Later on every draft shows the end card; Show them again brings back the first draft", async ({
  context,
  page,
}) => {
  await startSession(context, page, queue().owner);
  await page.goto("/approvals");
  for (let passed = 0; passed < E2E_QUEUE_WAITING; passed += 1) {
    await expect(detailOf(page)).toContainText(planAt(passed).subject);
    await laterOf(page).click();
  }
  await expect(page.getByRole("heading", { level: 2, name: en.appr_end_title })).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  await page.getByRole("button", { name: en.appr_show_again, exact: true }).click();
  await expect(detailOf(page)).toContainText(planAt(0).subject);
  expect(idOf(page)).toBe(queue().waitingSendIds[0]);
});

test("Yes sends to the delegate with the buttons off, then the next draft comes with its place", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, queue().owner);
  await page.goto("/approvals");
  await expect(page.getByText(stepText(1, E2E_QUEUE_WAITING))).toBeVisible();
  await expect(yesOf(page)).toBeEnabled();
  await yesOf(page).click();

  const outcome = statusOf(page, new RegExp(`^(Sent|Sending) to ${E2E_QUEUE.drafts[0].delegateName}`));
  await expect(outcome).toBeVisible();
  await expect(laterOf(page)).toBeDisabled();
  await expect(yesOf(page)).toHaveCount(0);
  await expect(noOf(page)).toHaveCount(0);
  await expect(outcome).toBeFocused();

  await expect(page.getByText(stepText(2, E2E_QUEUE_WAITING))).toBeVisible();
  await expect(detailOf(page)).toContainText(planAt(1).subject);
  expect(idOf(page)).toBe(queue().waitingSendIds[1]);
  await expect(detailOf(page).getByRole("heading", { level: 2 })).toBeFocused();
  expect(errors).toEqual([]);
});

async function waitingIds(page: Page): Promise<string[]> {
  const response = await page.request.get("/api/approvals");
  const body = (await response.json()) as { items: { id: string; state: string }[] };
  return body.items.filter((item) => item.state === "waiting").map((item) => item.id);
}

test("a double tap on Yes and taps on the same place afterwards send one mail only", async ({ context, page }) => {
  await startSession(context, page, queue().owner);
  await page.goto("/approvals");
  await expect(yesOf(page)).toBeEnabled();
  const [first, second] = [idOf(page), queue().waitingSendIds[queue().waitingSendIds.indexOf(idOf(page)) + 1] ?? ""];
  const before = await waitingIds(page);
  expect(before).toContain(second);
  const box = await yesOf(page).boundingBox();
  if (box === null) throw new Error("Yes has no box");
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];

  await yesOf(page).dblclick();
  // The first frame that shows the result, and the first frame that shows the next card: a tap on the old place does nothing.
  await textShown(page, /(Sent|Sending) to /);
  await page.mouse.click(x, y);
  await textShown(page, new RegExp(en.appr_approve));
  await page.mouse.click(x, y);
  await expect(detailOf(page).getByRole("heading", { level: 2 })).toBeVisible();

  expect(["sending", "sent", "held"]).toContain(await stateOf(page, first));
  expect(await stateOf(page, second)).toBe("waiting");
  expect(await waitingIds(page)).toEqual(before.filter((id) => id !== first));
});

test("the link of a rejected, a replaced and an unknown draft shows a closed card", async ({ context, page }) => {
  const errors = await startSession(context, page, queue().owner);
  const rejected = queue().waitingSendIds[4];
  const replaced = queue().waitingSendIds[3];
  await page.goto("/approvals");
  await decideByRequest(page, rejected, "reject");
  const edit = await page.request.post(`/api/approvals/${replaced}/edit`, {
    data: { subject: "E2E queue bravo changed", body: "Hello Anna, please handle the bravo case." },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(edit.status()).toBe(200);
  const newest = ((await edit.json()) as { id: string }).id;

  await page.goto(`/approvals?id=${rejected}`);
  await expect(detailOf(page)).toContainText(en.appr_state_rejected);
  await expect(yesOf(page)).toHaveCount(0);
  await expect(noOf(page)).toHaveCount(0);

  await page.goto(`/approvals?id=${replaced}`);
  await expect(detailOf(page)).toContainText(en.appr_state_superseded);
  await detailOf(page).getByRole("button", { name: en.appr_open_newest, exact: true }).click();
  await expect(detailOf(page)).toContainText("E2E queue bravo changed");
  expect(idOf(page)).toBe(newest);

  await page.goto("/approvals?id=0190f5a0-0000-7000-8000-0000000000ff");
  await expect(page.getByText(en.appr_not_found)).toBeVisible();
  await page.getByRole("button", { name: en.appr_go_waiting, exact: true }).click();
  await expect(detailOf(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test("the open card, the closed card and the end card have no axe violation", async ({ context, page }) => {
  await startSession(context, page, queue().owner);
  // The third draft is ready to decide; the newest one may still wait for its mailbox copy.
  await page.goto(`/approvals?id=${queue().waitingSendIds[2]}`);
  await buttonsReady(page);
  await expectNoA11yViolations(page);

  await page.goto(`/approvals?id=${queue().waitingSendIds[4]}`);
  await expect(detailOf(page)).toContainText(en.appr_state_rejected);
  await expectNoA11yViolations(page);

  await page.goto("/approvals");
  await expect(detailOf(page).getByRole("heading", { level: 2 })).toBeVisible();
  await laterOf(page).click();
  await expect(detailOf(page).getByRole("heading", { level: 2 })).toBeVisible();
  await laterOf(page).click();
  await expect(page.getByRole("heading", { level: 2, name: en.appr_end_title })).toBeVisible();
  await expectNoA11yViolations(page);
});

test("a draft that another device rejected shows a notice and leaves the queue when the tab turns visible", async ({
  context,
  page,
}) => {
  await startSession(context, page, queue().owner);
  await page.goto("/approvals");
  await expect(detailOf(page).getByRole("heading", { level: 2 })).toBeVisible();
  const focused = idOf(page);
  await decideByRequest(page, focused, "reject");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  await expect(statusOf(page, en.appr_closed_rejected)).toBeVisible();
  await expect.poll(() => idOf(page)).not.toBe(focused);
  expect(await stateOf(page, focused)).toBe("rejected");
});

test("on a phone the three buttons stay above the tab bar over a long draft, and so does the reason question", async ({
  context,
  page,
}) => {
  test.skip(project() !== "mobile", "the phone layout runs on the mobile project");
  await startSession(context, page, queue().owner);
  await page.setViewportSize({ width: 412, height: 600 });
  // A long draft: the answer of the detail route carries a body of many lines.
  await page.route(/\/api\/approvals\/[0-9a-f-]{36}$/, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { view: { body: string } | null };
    if (body.view !== null)
      body.view.body = Array.from({ length: 80 }, (_, line) => `Line ${line + 1} of a long draft.`).join("\n");
    await route.fulfill({ response, json: body });
  });
  await page.goto("/approvals");
  await expect(detailOf(page)).toContainText("Line 80 of a long draft.");
  const tabBar = page.getByRole("navigation", { name: en.nav_main });
  const aboveTabBar = async (locator: Locator) => {
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    const bar = await tabBar.boundingBox();
    if (box === null || bar === null) throw new Error("no box");
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(bar.y + 1);
  };
  await expect(yesOf(page)).toBeEnabled();
  await aboveTabBar(yesOf(page));
  await aboveTabBar(detailOf(page).getByRole("button", { name: en.appr_edit, exact: true }));
  await aboveTabBar(noOf(page));

  await noOf(page).click();
  await aboveTabBar(detailOf(page).getByRole("combobox", { name: en.appr_reason_label }));

  await page.getByRole("button", { name: allWaitingName }).click();
  await expect(listOf(page).getByRole("link").first()).toBeVisible();
});
