import { execFileSync } from "node:child_process";

import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { E2E_DELEGATIONS } from "../../../server/src/scripts/e2e-seed-args";
import { en } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
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

// The columns of the page, by the title of their heading; the closed list is named like its heading too.
const COLUMN_TITLES = {
  overdue: en.dgn_col_overdue,
  drafted: en.dgn_col_drafted,
  sent: en.dgn_col_sent,
  answered: en.dgn_col_answered,
  closed: en.dgn_col_closed,
} as const;
type Group = keyof typeof COLUMN_TITLES;
const listOf = (page: Page, group: Group) => page.getByRole("list", { name: COLUMN_TITLES[group], exact: true });
const headingOf = (page: Page, group: Group) =>
  page.getByRole("heading", { level: 2, name: COLUMN_TITLES[group], exact: true });
const columnBox = (page: Page, group: Group) =>
  page.locator('[data-slot="delegation-column"]').filter({ has: headingOf(page, group) });
const cardsOf = (page: Page, group: Group) => listOf(page, group).getByRole("listitem");
// A delegation card, wherever it sits now: tests move rows from one column to another.
const rowOf = (page: Page, key: Key) => page.getByRole("listitem").filter({ hasText: nameOf(key) });
const inColumn = (page: Page, group: Group, key: Key) => cardsOf(page, group).filter({ hasText: nameOf(key) });
const remindButton = (page: Page, key: Key) => page.getByRole("button", { name: fill(en.dgn_remind_for, nameOf(key)) });
const doneButton = (page: Page, key: Key) => page.getByRole("button", { name: fill(en.dgn_done_for, nameOf(key)) });
const cancelButton = (page: Page, key: Key) => page.getByRole("button", { name: fill(en.dgn_cancel_for, nameOf(key)) });
const closedButton = (page: Page) => page.getByRole("button", { name: en.dgn_closed_show });
const closedHideButton = (page: Page) => page.getByRole("button", { name: en.dgn_closed_hide });
// Opens the closed list and waits for its rows.
async function showClosed(page: Page) {
  await closedButton(page).click();
  await expect(headingOf(page, "closed")).toBeVisible();
}
// The line of the result: the page announces the result here and moves the focus to it after an action.
const status = (page: Page) => page.locator('[role="status"][tabindex="-1"]');
const remindersText = (n: number) => en.dgn_reminders.replace("{n}", `${n}`).replace("{max}", "2");
const cancelDialog = (page: Page) => page.getByRole("dialog", { name: en.dgn_cancel_title });

// The headings sit one under the other, at the same left edge.
async function expectStacked(headings: Locator[]) {
  const tops: number[] = [];
  const lefts: number[] = [];
  for (const heading of headings) {
    const box = await heading.boundingBox();
    if (box === null) throw new Error("A column heading has no box.");
    tops.push(box.y);
    lefts.push(box.x);
  }
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
  expect(new Set(tops).size).toBe(tops.length);
  expect(new Set(lefts).size).toBe(1);
}
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// Where each seeded delegation sits on a fresh page (the reads run before the actions).
const GROUP_OF: Record<Key, Group> = {
  drafted: "drafted",
  sent: "sent",
  overdue: "overdue",
  limit: "overdue",
  inactive: "overdue",
  answered: "answered",
  answeredMember: "answered",
  done: "closed",
  cancelled: "closed",
};

test("T4: each seeded delegation is in the column of its status; the drafted card links its draft to /approvals?id=", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegations");
  await expect(page.getByRole("heading", { level: 1, name: en.title_delegations })).toBeVisible();
  // The header tabs of the two delegation pages.
  const header = page.getByRole("navigation", { name: en.dlg_tabs_label });
  await expect(header.getByRole("link", { name: en.dlg_tab_delegations })).toHaveAttribute("aria-current", "page");
  await expect(header.getByRole("link", { name: en.dlg_tab_delegates })).toHaveAttribute("href", "/delegates");

  // The four columns, in the page order, each with the count of its rows.
  for (const group of ["overdue", "drafted", "sent", "answered"] as const)
    await expect(headingOf(page, group)).toBeVisible();
  const heads = await page.getByRole("heading", { level: 2 }).allTextContents();
  expect(heads.filter((text) => Object.values(COLUMN_TITLES).includes(text as never))).toEqual([
    en.dgn_col_overdue,
    en.dgn_col_drafted,
    en.dgn_col_sent,
    en.dgn_col_answered,
  ]);
  for (const key of Object.keys(E2E_DELEGATIONS) as Key[]) {
    const group = GROUP_OF[key];
    // The closed rows wait behind their button.
    if (group === "closed") await expect(rowOf(page, key)).toHaveCount(0);
    else await expect(inColumn(page, group, key)).toHaveCount(1);
  }
  await expect(cardsOf(page, "overdue")).toHaveCount(3);
  await expect(cardsOf(page, "answered")).toHaveCount(2);

  const sent = inColumn(page, "sent", "sent");
  await expect(sent).toContainText(E2E_DELEGATIONS.sent.delegateEmail);
  await expect(sent).toContainText(E2E_DELEGATIONS.sent.task);
  await expect(sent).toContainText(`${en.dgn_subject}: ${E2E_DELEGATIONS.sent.subject}`);
  await expect(sent).toContainText(remindersText(0));
  await expect(sent).toContainText(/Due \d{1,2} \w{3,4} \d{4}/);
  // The heading names the status, so a card in a column has no status badge.
  await expect(sent).not.toContainText(en.act_dlg_sent);
  const drafted = inColumn(page, "drafted", "drafted");
  await expect(drafted.getByRole("link", { name: en.dgn_open_draft })).toHaveAttribute(
    "href",
    `/approvals?id=${org().draftedSendId}`
  );
  // A drafted delegation has Cancel only.
  await expect(cancelButton(page, "drafted")).toBeVisible();
  await expect(remindButton(page, "drafted")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("T9: the closed list opens with its button or with ?filter=closed; a retention-cleared task shows a dash; other values change nothing", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  await page.goto("/delegations");
  await expect(closedButton(page)).toHaveAttribute("aria-expanded", "false");
  await expect(listOf(page, "closed")).toHaveCount(0);
  await showClosed(page);
  await expect(closedHideButton(page)).toHaveAttribute("aria-expanded", "true");
  const closed = listOf(page, "closed");
  await expect(closed.getByRole("listitem")).toHaveCount(2);
  // Closed rows keep the status badge.
  await expect(rowOf(page, "done")).toContainText(en.act_dlg_done);
  const cancelled = rowOf(page, "cancelled");
  await expect(cancelled).toContainText(en.act_dlg_cancelled);
  // The dash is for the eye, the sentence for a screen reader.
  await expect(cancelled).toContainText(en.dgn_task_removed);
  await expect(cancelled.getByText("—", { exact: true })).toBeVisible();
  await expect(cancelled.getByRole("button")).toHaveCount(0);
  await closedHideButton(page).click();
  await expect(closedButton(page)).toHaveAttribute("aria-expanded", "false");
  await expect(rowOf(page, "done")).toHaveCount(0);
  // The address opens the closed list at load and shows it.
  await page.goto("/delegations?filter=closed");
  await expect(closedHideButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(rowOf(page, "done")).toBeVisible();
  await expect(headingOf(page, "closed")).toBeInViewport();
  // The page writes no address.
  await expect(page).toHaveURL(/\/delegations\?filter=closed$/);
  // Every other value changes nothing: the closed list stays shut and all four columns show.
  for (const search of ["?filter=overdue", "?filter=answered", "?filter=nope"]) {
    await page.goto(`/delegations${search}`);
    await expect(headingOf(page, "sent")).toBeVisible();
    await expect(closedButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(rowOf(page, "done")).toHaveCount(0);
  }
});

test("a phone stacks the four columns top to bottom with no sideways scroll", async ({ context, page }) => {
  test.skip(project() !== "mobile", "the stack is the phone layout");
  await startSession(context, page, org().owner);
  await page.goto("/delegations");
  const groups = ["overdue", "drafted", "sent", "answered"] as const;
  for (const group of groups) await expect(headingOf(page, group)).toBeVisible();
  await expectStacked(groups.map((group) => headingOf(page, group)));
  expect(await fitsWidth(page)).toBe(true);
});

test("T12: Remind now is off with the reason on screen for a limit, an inactive delegate; the keyboard reaches the button and the reason", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  await page.goto("/delegations");
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
    await page.goto("/delegations");
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
  await page.goto("/delegations");
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
  await page.goto("/delegations");
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
  await page.goto("/delegations");
  await expect(inColumn(page, "answered", "answeredMember")).toBeVisible();
  await expect(doneButton(page, "answeredMember")).toBeVisible();
  await expect(page.getByText(en.dgn_owner_only)).toBeVisible();
  await expect(page.getByRole("button", { name: en.dgn_remind })).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.dgn_cancel })).toHaveCount(0);
  await expect(inColumn(page, "overdue", "limit")).toBeVisible();
  await expect(doneButton(page, "limit")).toBeVisible();
  await expect(remindButton(page, "limit")).toHaveCount(0);
  await expect(cancelButton(page, "limit")).toHaveCount(0);
  await expect(inColumn(page, "sent", "sent")).toBeVisible();
  await expect(inColumn(page, "sent", "sent").getByRole("button")).toHaveCount(0);
  const origin = new URL(page.url()).origin;
  const delegations = await page.request.get("/api/delegations?filter=open");
  const id = (await delegations.json()).items[0].id as string;
  for (const action of ["remind", "cancel"]) {
    const refused = await page.request.post(`/api/delegations/${id}/${action}`, { data: {}, headers: { origin } });
    expect(refused.status()).toBe(403);
  }
  expect(errors).toEqual([]);
});

test("T6: Answered, Mark as done: the card leaves its column and shows under the closed list", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegations");
  await expect(inColumn(page, "answered", "answered")).toBeVisible();
  await doneButton(page, "answered").click();
  await expect(status(page)).toContainText(fill(en.dgn_done_ok, nameOf("answered")));
  await expect(status(page)).toBeFocused();
  await expect(rowOf(page, "answered")).toHaveCount(0);
  await expect(inColumn(page, "answered", "answeredMember")).toBeVisible();
  await showClosed(page);
  await expect(rowOf(page, "answered")).toContainText(en.act_dlg_done);
  await expect(rowOf(page, "answered").getByRole("button")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("T7: Cancel on the sent card asks first; Keep returns the focus to Cancel; confirm shows the card in the closed list as cancelled", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegations");
  await expect(inColumn(page, "sent", "sent")).toBeVisible();
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
  await expect(inColumn(page, "sent", "sent")).toBeVisible();
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
  await expect(inColumn(page, "drafted", "drafted")).toBeVisible();
  await showClosed(page);
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

// The state of a delegation changes "elsewhere" (the delegate answers, another owner closes it): the test writes it into the database with the
// migrator role, then makes the page reload. The 30 s timer would do the same; a `visibilitychange` event runs the reload at once.
function sql(query: string): string {
  const url = process.env.E2E_MIGRATOR_DATABASE_URL ?? "";
  return execFileSync("psql", [url, "-tA", "-c", query], { encoding: "utf8" }).trim();
}
function setStatus(key: Key, status: "overdue" | "answered" | "done"): void {
  const answered = status === "answered" ? "now()" : "null";
  sql(
    `update delegations d set status='${status}', answered_at=${answered} from delegates g where g.id=d.delegate_id and d.org_id='${org().orgId}' and g.name='${nameOf(key)}'`
  );
}
async function reloadNow(page: Page): Promise<void> {
  const reloaded = page.waitForResponse((response) => response.url().includes("/api/delegations?"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await reloaded;
}
const activeTag = (page: Page) => page.evaluate(() => document.activeElement?.tagName ?? "null");

test("T17: the delegation changes status while the cancel question is open: the question stays; Confirm says it is closed and the status line has the focus", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  await page.goto("/delegations");
  await cancelButton(page, "limit").click();
  const dialog = cancelDialog(page);
  await expect(dialog).toBeVisible();
  try {
    setStatus("limit", "answered");
    await reloadNow(page);
    // The reload moved the card to the Answered column; the question stays, with its focus.
    await expect(inColumn(page, "answered", "limit")).toBeVisible();
    await expect(inColumn(page, "overdue", "limit")).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: en.dgn_keep })).toBeFocused();
    await dialog.getByRole("button", { name: en.dgn_cancel_confirm }).click();
    await expect(dialog).toHaveCount(0);
    await expect(status(page)).toContainText(en.dgn_closed);
    await expect(status(page)).toBeFocused();
  } finally {
    setStatus("limit", "overdue");
  }
});

test("T18: the user closes the cancel question after the card moved: the focus is on the status line with a text, never on the page body", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  await page.goto("/delegations");
  await cancelButton(page, "limit").click();
  const dialog = cancelDialog(page);
  await expect(dialog).toBeVisible();
  try {
    setStatus("limit", "answered");
    await reloadNow(page);
    await expect(inColumn(page, "answered", "limit")).toBeVisible();
    // An answered delegation has no Cancel button to return to.
    await dialog.getByRole("button", { name: en.dgn_keep }).click();
    await expect(dialog).toHaveCount(0);
    await expect(status(page)).toBeFocused();
    await expect(status(page)).toContainText(en.dgn_moved);
    expect(await activeTag(page)).not.toBe("BODY");
  } finally {
    setStatus("limit", "overdue");
  }
});

test("T19: a reload takes the card whose button has the focus out of every column (Done, Remind now): the focus goes to the status line with a text, not to the page body", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  await page.goto("/delegations");
  const cases = [
    ["limit", doneButton(page, "limit")],
    ["inactive", remindButton(page, "inactive")],
  ] as const;
  for (const [key, button] of cases) {
    await expect(rowOf(page, key)).toBeVisible();
    await button.focus();
    await expect(button).toBeFocused();
    try {
      // Closed delegations sit behind their button, so the card is in no column now.
      setStatus(key, "done");
      await reloadNow(page);
      await expect(rowOf(page, key)).toHaveCount(0);
      await expect(status(page)).toBeFocused();
      await expect(status(page)).toContainText(en.dgn_moved);
    } finally {
      setStatus(key, "overdue");
    }
    // The next round starts from a loaded page with the card back.
    await page.goto("/delegations");
  }
});

test("a reload moves the card whose button has the focus to another column: the focus stays on its new card", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  await page.goto("/delegations");
  await expect(inColumn(page, "overdue", "limit")).toBeVisible();
  await doneButton(page, "limit").focus();
  try {
    setStatus("limit", "answered");
    await reloadNow(page);
    await expect(inColumn(page, "answered", "limit")).toBeVisible();
    await expect(inColumn(page, "answered", "limit")).toBeFocused();
    await expect(status(page)).not.toBeFocused();
    await expect(status(page)).toHaveText("");
  } finally {
    setStatus("limit", "overdue");
  }
});

test("T10: the columns, the closed list, an empty column and the cancel question have no axe violation", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  await page.goto("/delegations");
  await expect(inColumn(page, "overdue", "limit")).toBeVisible();
  await expectNoA11yViolations(page);
  await showClosed(page);
  await expect(rowOf(page, "done")).toBeVisible();
  await expectNoA11yViolations(page);
  // The question: the page also shows the off Remind now buttons and the reasons.
  await cancelButton(page, "limit").click();
  await expect(cancelDialog(page)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press("Escape");
  // An empty column and a result line.
  await doneButton(page, "answeredMember").click();
  await expect(status(page)).toContainText(fill(en.dgn_done_ok, nameOf("answeredMember")));
  await expect(columnBox(page, "answered")).toContainText(en.dgn_col_empty_answered);
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
  await expect(headingOf(page, "overdue")).toHaveCount(0);
  await expect(closedButton(page)).toHaveCount(0);
  await expectNoA11yViolations(page);
});

// The page is Polish for a Polish browser and a user with no stored choice: the four columns stack on a phone, and nothing scrolls sideways.
test.describe("in Polish", () => {
  test.use({ locale: "pl-PL" });

  test("the four columns have Polish headings, stack on a phone and fit the screen", async ({ context, page }) => {
    await startSession(context, page, org().owner);
    await page.goto("/delegations");
    const titles = [pl.dgn_col_overdue, pl.dgn_col_drafted, pl.dgn_col_sent, pl.dgn_col_answered];
    const headings = titles.map((name) => page.getByRole("heading", { level: 2, name, exact: true }));
    for (const heading of headings) await expect(heading).toBeVisible();
    await expect(page.getByRole("button", { name: pl.dgn_closed_show })).toBeVisible();
    if (project() === "mobile") await expectStacked(headings);
    expect(await fitsWidth(page)).toBe(true);
    await expectNoA11yViolations(page);
  });
});
