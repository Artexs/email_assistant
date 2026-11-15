import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { E2E_DELEGATIONS } from "../../../server/src/scripts/e2e-seed-args";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The delegations organization of the project (see `e2e-delegations-rows.ts`): the three flags are on, the mailbox is in assist mode with
// drafts on, and there is one delegation for each case of the page. The tests change the rows, so the tests of a project run in this
// order: the reads first, then remind, done and cancel.
test.describe.configure({ mode: "serial" });

const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().delegationsOrgs[project()];

// Every test signs in once, from its own client address: the login rate limit counts per address. Documentation range 203.0.113.0/24,
// a block per project (200–224 and 225–249), away from the blocks of the other specs.
let signIns = 0;
async function startSession(context: BrowserContext, page: Page, user: { email: string; password: string }) {
  signIns += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${(project() === "mobile" ? 200 : 225) + signIns}`,
  });
  const errors = await cspErrors(page);
  await signInAs(page, user);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return errors;
}

type Key = keyof typeof E2E_DELEGATIONS;
const nameOf = (key: Key): string => E2E_DELEGATIONS[key].delegateName;
const fill = (text: string, name: string) => text.replace("{name}", name);

const listOf = (page: Page) => page.getByRole("list", { name: en.dgn_list_label });
const rowOf = (page: Page, key: Key) =>
  listOf(page)
    .getByRole("listitem")
    .filter({ hasText: nameOf(key) });
const remindButton = (page: Page, key: Key) => page.getByRole("button", { name: fill(en.dgn_remind_for, nameOf(key)) });
const doneButton = (page: Page, key: Key) => page.getByRole("button", { name: fill(en.dgn_done_for, nameOf(key)) });
const cancelButton = (page: Page, key: Key) => page.getByRole("button", { name: fill(en.dgn_cancel_for, nameOf(key)) });
const filterTabs = (page: Page) => page.getByRole("navigation", { name: en.dgn_filters_label });
const filterLink = (page: Page, name: string) => filterTabs(page).getByRole("link", { name, exact: true });
// The line of the result: the page announces the result here and moves the focus to it after an action.
const status = (page: Page) => page.locator('[role="status"][tabindex="-1"]');
const remindersText = (n: number) => en.dgn_reminders.replace("{n}", `${n}`).replace("{max}", "2");
const cancelDialog = (page: Page) => page.getByRole("dialog", { name: en.dgn_cancel_title });

const TABS = [
  ["open", en.dgn_filter_open],
  ["overdue", en.dgn_filter_overdue],
  ["answered", en.dgn_filter_answered],
  ["closed", en.dgn_filter_closed],
] as const;

test("T4: Open shows the sent and the drafted rows; the drafted row links its draft to /approvals?id=", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegations");
  await expect(page.getByRole("heading", { level: 1, name: en.title_delegations })).toBeVisible();
  await expect(filterLink(page, en.dgn_filter_open)).toHaveAttribute("aria-current", "page");
  // The header tabs of the two delegation pages.
  const header = page.getByRole("navigation", { name: en.dlg_tabs_label });
  await expect(header.getByRole("link", { name: en.dlg_tab_delegations })).toHaveAttribute("aria-current", "page");
  await expect(header.getByRole("link", { name: en.dlg_tab_delegates })).toHaveAttribute("href", "/delegates");

  const sent = rowOf(page, "sent");
  await expect(sent).toContainText(E2E_DELEGATIONS.sent.delegateEmail);
  await expect(sent).toContainText(E2E_DELEGATIONS.sent.task);
  await expect(sent).toContainText(`${en.dgn_subject}: ${E2E_DELEGATIONS.sent.subject}`);
  await expect(sent).toContainText(en.act_dlg_sent);
  await expect(sent).toContainText(remindersText(0));
  await expect(sent).toContainText(/Due \d{1,2} \w{3,4} \d{4}/);
  const drafted = rowOf(page, "drafted");
  await expect(drafted).toContainText(en.act_dlg_drafted);
  await expect(drafted.getByRole("link", { name: en.dgn_open_draft })).toHaveAttribute(
    "href",
    `/approvals?id=${org().draftedSendId}`
  );
  // A drafted delegation has Cancel only; the other states are on other tabs.
  await expect(cancelButton(page, "drafted")).toBeVisible();
  await expect(remindButton(page, "drafted")).toHaveCount(0);
  await expect(rowOf(page, "overdue")).toHaveCount(0);
  await expect(rowOf(page, "answered")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("T9: /delegations?filter=closed opens on Closed; each tab has its own address; a retention-cleared task shows a dash", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  await page.goto("/delegations?filter=closed");
  await expect(filterLink(page, en.dgn_filter_closed)).toHaveAttribute("aria-current", "page");
  await expect(rowOf(page, "done")).toContainText(en.act_dlg_done);
  const cancelled = rowOf(page, "cancelled");
  await expect(cancelled).toContainText(en.act_dlg_cancelled);
  // The dash is for the eye, the sentence for a screen reader.
  await expect(cancelled).toContainText(en.dgn_task_removed);
  await expect(cancelled.getByText("—", { exact: true })).toBeVisible();
  await expect(cancelled.getByRole("button")).toHaveCount(0);
  // The links keep the tab, a plain click changes it without a page load, and back returns.
  for (const [filter, label] of TABS) {
    await expect(filterLink(page, label)).toHaveAttribute("href", `/delegations?filter=${filter}`);
  }
  await filterLink(page, en.dgn_filter_overdue).click();
  await expect(page).toHaveURL(/\/delegations\?filter=overdue$/);
  await expect(filterLink(page, en.dgn_filter_overdue)).toHaveAttribute("aria-current", "page");
  await expect(rowOf(page, "overdue")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/filter=closed$/);
  await expect(filterLink(page, en.dgn_filter_closed)).toHaveAttribute("aria-current", "page");
  await expect(rowOf(page, "done")).toBeVisible();
  // An unknown value opens on Open.
  await page.goto("/delegations?filter=nope");
  await expect(filterLink(page, en.dgn_filter_open)).toHaveAttribute("aria-current", "page");
});

test("T12: Remind now is off with the reason on screen for a limit, an inactive delegate; the keyboard reaches the button and the reason", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  await page.goto("/delegations?filter=overdue");
  await expect(rowOf(page, "overdue")).toBeVisible();
  const ready = remindButton(page, "overdue");
  await expect(ready).not.toHaveAttribute("aria-disabled", "true");
  const limit = remindButton(page, "limit");
  await expect(limit).toHaveAttribute("aria-disabled", "true");
  await expect(limit).toHaveAccessibleDescription(en.dgn_remind_limit_reached.replace("{max}", "2"));
  await expect(rowOf(page, "limit")).toContainText(en.dgn_remind_limit_reached.replace("{max}", "2"));
  await expect(rowOf(page, "limit")).toContainText(remindersText(2));
  const inactive = remindButton(page, "inactive");
  await expect(inactive).toHaveAttribute("aria-disabled", "true");
  await expect(inactive).toHaveAccessibleDescription(en.dgn_remind_delegate_inactive);
  // The delegate is off: the badge says so, and Done and Cancel still work for the owner.
  await expect(rowOf(page, "inactive").getByText(en.dlg_state_off, { exact: true })).toBeVisible();
  await expect(doneButton(page, "inactive")).toBeVisible();
  await expect(cancelButton(page, "inactive")).toBeVisible();
  // A press on an off button does nothing: no request, no result line.
  let posted = 0;
  await page.route("**/api/delegations/*/remind", (route) => {
    posted += 1;
    return route.abort();
  });
  await limit.click({ force: true });
  await inactive.focus();
  await page.keyboard.press("Enter");
  expect(posted).toBe(0);
  await expect(status(page)).toHaveText("");
  await page.unroute("**/api/delegations/*/remind");
  // The button stays in the tab order (not `disabled`): a keyboard user reaches it.
  await limit.focus();
  await expect(limit).toBeFocused();
});

test("T13: each 409 answer of Remind now gives its own text; `drafts_off` also turns the button off with the reason", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  const codes = [
    ["not_open", en.dgn_remind_not_open],
    ["limit_reached", en.dgn_remind_limit_reached.replace("{max}", "2")],
    ["reminder_waiting", en.dgn_remind_reminder_waiting],
    ["drafts_off", en.dgn_remind_drafts_off],
    ["delegate_inactive", en.dgn_remind_delegate_inactive],
  ] as const;
  for (const [code, text] of codes) {
    await page.goto("/delegations?filter=overdue");
    await expect(rowOf(page, "overdue")).toBeVisible();
    await page.route("**/api/delegations/*/remind", (route) =>
      route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: code }) })
    );
    await remindButton(page, "overdue").click();
    await expect(status(page)).toContainText(text);
    await expect(status(page)).toBeFocused();
    if (code === "drafts_off") {
      const button = remindButton(page, "overdue");
      await expect(button).toHaveAttribute("aria-disabled", "true");
      await expect(button).toHaveAccessibleDescription(text);
    }
    await page.unroute("**/api/delegations/*/remind");
  }
  // A 404 says that the delegation is gone; a 500 gives the general error.
  await page.goto("/delegations?filter=overdue");
  await expect(rowOf(page, "overdue")).toBeVisible();
  await page.route("**/api/delegations/*/remind", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) })
  );
  await remindButton(page, "overdue").click();
  await expect(status(page)).toContainText(en.dgn_gone);
  await page.unroute("**/api/delegations/*/remind");
  await page.route("**/api/delegations/*/remind", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal" }) })
  );
  await remindButton(page, "overdue").click();
  await expect(status(page)).toContainText(en.error_generic);
});

test("T5: Overdue, Remind now: Reminder planned with a link; after the reload the row waits for the approval and Remind now is off", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegations?filter=overdue");
  await expect(rowOf(page, "overdue")).toBeVisible();
  await remindButton(page, "overdue").click();
  await expect(status(page)).toContainText(en.dgn_reminded);
  await expect(status(page).getByRole("link", { name: en.dgn_reminded_link })).toHaveAttribute(
    "href",
    /^\/approvals\?id=[0-9a-f-]{36}$/
  );
  // The focus is on the result line, not lost on the page start.
  await expect(status(page)).toBeFocused();
  const row = rowOf(page, "overdue");
  await expect(row).toContainText(en.dgn_reminder_waits);
  await expect(row.getByRole("link", { name: en.dgn_open_approvals })).toHaveAttribute("href", "/approvals");
  await expect(remindButton(page, "overdue")).toHaveAttribute("aria-disabled", "true");
  await expect(remindButton(page, "overdue")).toHaveAccessibleDescription(en.dgn_remind_reminder_waiting);
  await expect(row).toContainText(remindersText(0));
  // A second press does not plan a second reminder: the off button sends no request.
  let posted = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/remind")) posted += 1;
  });
  await remindButton(page, "overdue").click({ force: true });
  await page.waitForTimeout(300);
  expect(posted).toBe(0);
  expect(errors).toEqual([]);
});

test("T8: the member sees Done on an answered row and no Remind now or Cancel; the server refuses a member too", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().member);
  await page.goto("/delegations?filter=answered");
  await expect(rowOf(page, "answeredMember")).toBeVisible();
  await expect(doneButton(page, "answeredMember")).toBeVisible();
  await expect(page.getByText(en.dgn_owner_only)).toBeVisible();
  await expect(page.getByRole("button", { name: en.dgn_remind })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.dgn_cancel })).toHaveCount(0);
  await page.goto("/delegations?filter=overdue");
  await expect(rowOf(page, "limit")).toBeVisible();
  await expect(doneButton(page, "limit")).toBeVisible();
  await expect(remindButton(page, "limit")).toHaveCount(0);
  await expect(cancelButton(page, "limit")).toHaveCount(0);
  await page.goto("/delegations");
  await expect(rowOf(page, "sent")).toBeVisible();
  await expect(rowOf(page, "sent").getByRole("button")).toHaveCount(0);
  const origin = new URL(page.url()).origin;
  const delegations = await page.request.get("/api/delegations?filter=open");
  const id = (await delegations.json()).items[0].id as string;
  for (const action of ["remind", "cancel"]) {
    const refused = await page.request.post(`/api/delegations/${id}/${action}`, { data: {}, headers: { origin } });
    expect(refused.status()).toBe(403);
  }
  expect(errors).toEqual([]);
});

test("T6: Answered, Mark as done: the row leaves the tab and shows under Closed", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegations?filter=answered");
  await expect(rowOf(page, "answered")).toBeVisible();
  await doneButton(page, "answered").click();
  await expect(status(page)).toContainText(fill(en.dgn_done_ok, nameOf("answered")));
  await expect(status(page)).toBeFocused();
  await expect(rowOf(page, "answered")).toHaveCount(0);
  await expect(rowOf(page, "answeredMember")).toBeVisible();
  await filterLink(page, en.dgn_filter_closed).click();
  await expect(rowOf(page, "answered")).toContainText(en.act_dlg_done);
  await expect(rowOf(page, "answered").getByRole("button")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("T7: Cancel on the sent row asks first; Keep returns the focus to Cancel; confirm shows the row under Closed as cancelled", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegations");
  await expect(rowOf(page, "sent")).toBeVisible();
  const cancel = cancelButton(page, "sent");
  await cancel.click();
  const dialog = cancelDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(en.dgn_cancel_text.replace("{name}", nameOf("sent")));
  await expect(dialog.getByRole("button", { name: en.dgn_keep })).toBeFocused();
  // Keep: nothing changes and the focus returns to the button that opened the question.
  await dialog.getByRole("button", { name: en.dgn_keep }).click();
  await expect(dialog).toHaveCount(0);
  await expect(cancel).toBeFocused();
  await expect(rowOf(page, "sent")).toContainText(en.act_dlg_sent);
  // Escape does the same.
  await cancel.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(cancel).toBeFocused();
  // Confirm.
  await cancel.click();
  await dialog.getByRole("button", { name: en.dgn_cancel_confirm }).click();
  await expect(dialog).toHaveCount(0);
  await expect(status(page)).toContainText(fill(en.dgn_cancelled, nameOf("sent")));
  await expect(status(page)).toBeFocused();
  await expect(rowOf(page, "sent")).toHaveCount(0);
  await expect(rowOf(page, "drafted")).toBeVisible();
  await filterLink(page, en.dgn_filter_closed).click();
  await expect(rowOf(page, "sent")).toContainText(en.act_dlg_cancelled);
  expect(errors).toEqual([]);
});

test("T14: the keyboard alone opens the cancel question, keeps the delegation, and cancels the drafted one", async ({
  context,
  page,
}) => {
  test.skip(project() === "mobile", "the keyboard path runs on the desktop project");
  await startSession(context, page, org().owner);
  await page.goto("/delegations");
  await expect(rowOf(page, "drafted")).toBeVisible();
  const cancel = cancelButton(page, "drafted");
  await cancel.focus();
  await page.keyboard.press("Enter");
  const dialog = cancelDialog(page);
  await expect(dialog.getByRole("button", { name: en.dgn_keep })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: en.dgn_cancel_confirm })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(status(page)).toContainText(fill(en.dgn_cancelled, nameOf("drafted")));
  await expect(status(page)).toBeFocused();
  await expect(rowOf(page, "drafted")).toHaveCount(0);
});

test("T15: Show more loads the next page with the cursor and puts the focus on the first new row", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  const item = (n: number) => ({
    kind: "delegation",
    id: `0190f5a0-0000-7000-8000-${String(n).padStart(12, "0")}`,
    status: "done",
    delegate: {
      id: "0190f5a0-0000-7000-8000-0000000000d1",
      name: `Paged ${n}`,
      email: `paged${n}@example.com`,
      active: true,
    },
    task: `Paged task ${n}`,
    subject: null,
    dueAt: null,
    sentAt: null,
    answeredAt: null,
    remindersSent: 0,
    reminderWaiting: false,
    sendId: null,
  });
  const requests: string[] = [];
  await page.route(/\/api\/delegations\?/, (route) => {
    const url = new URL(route.request().url());
    requests.push(url.searchParams.get("before") ?? "");
    const second = url.searchParams.get("before") === "cursor-2";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        second ? { items: [item(3), item(4)], next: null } : { items: [item(1), item(2)], next: "cursor-2" }
      ),
    });
  });
  await page.goto("/delegations?filter=closed");
  await expect(listOf(page).getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: en.dgn_more }).click();
  await expect(listOf(page).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("button", { name: en.dgn_more })).toHaveCount(0);
  await expect(listOf(page).getByRole("listitem").filter({ hasText: "Paged 3" })).toBeFocused();
  // No subject and no due date show words.
  await expect(rowOf0(page, "Paged 3")).toContainText(`${en.dgn_subject}: ${en.dgn_no_subject}`);
  await expect(rowOf0(page, "Paged 3")).toContainText(en.dgn_no_due);
  expect(requests).toEqual(["", "cursor-2"]);
});

const rowOf0 = (page: Page, text: string) => listOf(page).getByRole("listitem").filter({ hasText: text });

test("T10: every filter tab and the cancel question have no axe violation", async ({ context, page }) => {
  await startSession(context, page, org().owner);
  // Earlier tests moved rows, so a tab can be empty: the list or the empty text is the loaded page.
  const empty = {
    open: en.dgn_empty_open,
    overdue: en.dgn_empty_overdue,
    answered: en.dgn_empty_answered,
    closed: en.dgn_empty_closed,
  };
  for (const [filter, label] of TABS) {
    await page.goto(`/delegations?filter=${filter}`);
    await expect(filterLink(page, label)).toHaveAttribute("aria-current", "page");
    await expect(listOf(page).or(page.getByText(empty[filter]))).toBeVisible();
    await expectNoA11yViolations(page);
  }
  // The question: on Overdue, where the page also shows the off Remind now buttons and the reasons.
  await page.goto("/delegations?filter=overdue");
  await expect(rowOf(page, "limit")).toBeVisible();
  await cancelButton(page, "limit").click();
  await expect(cancelDialog(page)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press("Escape");
  // The empty state and a result line.
  await page.goto("/delegations?filter=answered");
  await doneButton(page, "answeredMember").click();
  await expect(status(page)).toContainText(fill(en.dgn_done_ok, nameOf("answeredMember")));
  await expect(page.getByText(en.dgn_empty_answered)).toBeVisible();
  await expectNoA11yViolations(page);
});

test("T11: with the three flags on the phone tab bar has 5 tabs and the sidebar shows all items; the page is the current one", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegations");
  const nav = page.getByRole("navigation", { name: en.nav_main });
  await expect(nav.getByRole("link", { name: en.nav_delegations })).toHaveAttribute("aria-current", "page");
  if (project() === "mobile") {
    // The Approvals tab also carries the count of waiting sends.
    await expect(nav.getByRole("link")).toContainText([
      en.nav_activity,
      en.nav_approvals,
      en.nav_delegations,
      en.nav_mailboxes,
      en.nav_settings,
    ]);
    await expect(nav.getByRole("link")).toHaveCount(5);
    await page.getByRole("button", { name: en.menu_open }).click();
    const menu = page.getByRole("dialog");
    await expect(menu.getByRole("link", { name: en.nav_rules })).toBeVisible();
    await expect(menu.getByRole("link", { name: en.nav_stats })).toBeVisible();
    await expectNoA11yViolations(page);
  } else {
    for (const name of [
      en.nav_activity,
      en.nav_approvals,
      en.nav_delegations,
      en.nav_mailboxes,
      en.nav_settings,
      en.nav_rules,
      en.nav_stats,
    ]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});

test("T16: with the flag off, /delegations shows the flag-off text", async ({ context, page }) => {
  // The main organization of the run has no `delegation_pages` flag.
  const { owner } = readSeed();
  signIns += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${(project() === "mobile" ? 200 : 225) + signIns}`,
  });
  await signInAs(page, owner);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await page.goto("/delegations");
  await expect(page.getByText(en.dlg_off)).toBeVisible();
  await expect(page.getByRole("list", { name: en.dgn_list_label })).toHaveCount(0);
  await expectNoA11yViolations(page);
});
