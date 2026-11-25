import { execFileSync } from "node:child_process";

import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { E2E_DELEGATIONS, E2E_OPEN_LOOPS, E2E_OPEN_LOOPS_DELEGATE } from "../../../server/src/scripts/e2e-seed-args";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The open loops organization of the project (see `e2e-open-loops-rows.ts`): the flags `open_loops`, `delegation_pages` and `approvals_page`
// are on, the mailbox is in assist mode with drafts on, and there is one loop for each kind and state of the page. The tests change the
// rows, so the tests of a project run in this order: the reads first, then the actions (draft, later, done, untrack, drop), then the closing-loop test.
test.describe.configure({ mode: "serial" });

const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().openLoopsOrgs[project()];

// Every test signs in once, from its own client address: the login rate limit counts per address. Documentation range 203.0.113.0/24,
// a block per project (30–54 and 130–154 here), away from the blocks of the other specs.
let signIns = 0;
async function startSession(context: BrowserContext, page: Page, user: { email: string; password: string }) {
  signIns += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${(project() === "mobile" ? 30 : 130) + signIns}`,
  });
  const errors = await cspErrors(page);
  await signInAs(page, user);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return errors;
}

type Key = keyof typeof E2E_OPEN_LOOPS;
const textOf = (key: Key): string => E2E_OPEN_LOOPS[key].text;
const counterpartOf = (key: Key): string => E2E_OPEN_LOOPS[key].counterpart;
// The name that the buttons of a row carry: who it is about (the delegate for a delegated loop, else the counterpart) and its text.
const whoOf = (key: Key): string =>
  E2E_OPEN_LOOPS[key].kind === "delegated" ? E2E_OPEN_LOOPS_DELEGATE.name : counterpartOf(key);
const nameOf = (key: Key): string => `${whoOf(key)}, ${textOf(key)}`;
const fill = (text: string, name: string) => text.replace("{name}", name);

// The list region of one kind: the page has one per tab (the Delegated tab has the delegations list above it).
const regionOf = (page: Page, kind: "waiting" | "promised" | "delegated") =>
  page.getByRole("region", { name: en[`lp_list_${kind}`] });
const rowOf = (region: Locator, key: Key) => region.getByRole("listitem").filter({ hasText: textOf(key) });
const buttonOf = (region: Locator, key: Key, label: string) =>
  region.getByRole("button", { name: fill(label, nameOf(key)) });
// The line of the result: the page announces the result here and moves the focus to it after an action.
const statusOf = (region: Locator) => region.locator('[role="status"][tabindex="-1"]');
const tabsOf = (page: Page) => page.getByRole("navigation", { name: en.lp_tabs_label });
const tabLink = (page: Page, name: string) => tabsOf(page).getByRole("link", { name, exact: true });
const filtersOf = (page: Page) => page.getByRole("navigation", { name: en.lp_filters_label });
const filterLink = (page: Page, name: string) => filtersOf(page).getByRole("link", { name, exact: true });
const confirmDialog = (page: Page, title: string) => page.getByRole("dialog", { name: title });
const dueOf = (row: Locator) => row.getByText(/^Due \d{1,2} \w{3,4} \d{4}/);

const WAITING = "/delegations?tab=waiting";
const PROMISED = "/delegations?tab=promised";

// The state of a loop changes "elsewhere": the test writes it into the database with the migrator role.
function sql(query: string): string {
  const url = process.env.E2E_MIGRATOR_DATABASE_URL ?? "";
  return execFileSync("psql", [url, "-tA", "-c", query], { encoding: "utf8" }).trim();
}

test("T10: the address names the tab and the filter; Delegated is the default; an unknown tab opens on Delegated", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegations");
  await expect(page.getByRole("heading", { level: 1, name: en.title_open_loops })).toBeVisible();
  await expect(tabLink(page, en.lp_tab_delegated)).toHaveAttribute("aria-current", "page");
  await page.goto("/delegations?tab=promised");
  await expect(tabLink(page, en.lp_tab_promised)).toHaveAttribute("aria-current", "page");
  await expect(regionOf(page, "promised")).toBeVisible();
  await expect(filterLink(page, en.dgn_filter_open)).toHaveAttribute("aria-current", "page");
  await page.goto("/delegations?tab=waiting&filter=due");
  await expect(tabLink(page, en.lp_tab_waiting)).toHaveAttribute("aria-current", "page");
  await expect(filterLink(page, en.lp_filter_due)).toHaveAttribute("aria-current", "page");
  await page.goto("/delegations?tab=nope");
  await expect(tabLink(page, en.lp_tab_delegated)).toHaveAttribute("aria-current", "page");
  // The links keep the tab, a plain click changes it without a page load, and back returns.
  await expect(tabLink(page, en.lp_tab_waiting)).toHaveAttribute("href", "/delegations?tab=waiting");
  await expect(tabLink(page, en.lp_tab_promised)).toHaveAttribute("href", "/delegations?tab=promised");
  await tabLink(page, en.lp_tab_promised).click();
  await expect(page).toHaveURL(/\/delegations\?tab=promised$/);
  await expect(tabLink(page, en.lp_tab_promised)).toHaveAttribute("aria-current", "page");
  await expect(rowOf(regionOf(page, "promised"), "promView")).toBeVisible();
  await filterLink(page, en.dgn_filter_closed).click();
  await expect(page).toHaveURL(/tab=promised&filter=closed$/);
  await expect(rowOf(regionOf(page, "promised"), "promClosed")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/delegations\?tab=promised$/);
  await expect(filterLink(page, en.dgn_filter_open)).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(tabLink(page, en.lp_tab_delegated)).toHaveAttribute("aria-current", "page");
  // The header of the delegations pages stays.
  const header = page.getByRole("navigation", { name: en.dlg_tabs_label });
  await expect(header.getByRole("link", { name: en.dlg_tab_delegates })).toHaveAttribute("href", "/delegates");
  expect(errors).toEqual([]);
});

test("rows: each kind shows its counterpart, text, reason, due date and counters; the filters split the loops", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(WAITING);
  const waiting = regionOf(page, "waiting");
  const view = rowOf(waiting, "waitView");
  await expect(view).toContainText(counterpartOf("waitView"));
  await expect(view).toContainText(/You asked a question; no answer for \d+ working days?\./);
  await expect(view).toContainText(/Due \d{1,2} \w{3,4} \d{4} \(default wait\)/);
  await expect(view).toContainText(en.lp_follow_ups.replace("{n}", "0").replace("{max}", "2"));
  await expect(view).toContainText(en.lp_status_open);
  await expect(view).not.toContainText("Usual reply");
  // A due date from the usual reply time of the contact says so and shows that time under the date.
  const contact = rowOf(waiting, "waitContact");
  await expect(contact).toContainText(/Due \d{1,2} \w{3,4} \d{4} \(usual reply time of this contact\)/);
  await expect(contact).toContainText(en.lp_usual_reply.replace("{n}", "2"));
  // Two follow-ups sent: the button is off with the reason on screen, and the keyboard reaches both.
  const limit = rowOf(waiting, "waitLimit");
  await expect(limit).toContainText(en.lp_follow_ups.replace("{n}", "2").replace("{max}", "2"));
  const limitButton = buttonOf(waiting, "waitLimit", en.lp_follow_up_for);
  await expect(limitButton).toHaveAttribute("aria-disabled", "true");
  await expect(limitButton).toHaveAccessibleDescription(en.lp_c_follow_up_limit);
  await expect(limit).toContainText(en.lp_c_follow_up_limit);
  await limitButton.focus();
  await expect(limitButton).toBeFocused();
  // A press on the off button does nothing: no request, no result line.
  let posted = 0;
  await page.route("**/api/loops/*/follow-up", (route) => {
    posted += 1;
    return route.abort();
  });
  await limitButton.click({ force: true });
  await page.keyboard.press("Enter");
  expect(posted).toBe(0);
  await expect(statusOf(waiting)).toHaveText("");
  await page.unroute("**/api/loops/*/follow-up");
  // An owner has no note about owner-only actions.
  await expect(page.getByText(en.lp_owner_only)).toHaveCount(0);
  // Only an auto-reply came.
  await expect(rowOf(waiting, "waitAuto")).toContainText(en.lp_auto_reply_only);
  await expect(view).not.toContainText(en.lp_auto_reply_only);
  // A follow-up waits: the notice and the link to the approval, and no Draft follow-up button.
  const pending = rowOf(waiting, "waitPending");
  await expect(pending).toContainText(en.lp_follow_up_waits);
  await expect(pending.getByRole("link", { name: en.lp_follow_up_link })).toHaveAttribute(
    "href",
    `/approvals?id=${org().pendingSendId}`
  );
  await expect(buttonOf(waiting, "waitPending", en.lp_follow_up_for)).toHaveCount(0);
  await expect(buttonOf(waiting, "waitPending", en.lp_done_for)).toBeVisible();
  // Open holds the future loop; Due today holds the past-due ones and leaves the future one out.
  await expect(rowOf(waiting, "waitFuture")).toBeVisible();
  await filterLink(page, en.lp_filter_due).click();
  await expect(page).toHaveURL(/tab=waiting&filter=due$/);
  await expect(rowOf(waiting, "waitView")).toBeVisible();
  await expect(rowOf(waiting, "waitFuture")).toHaveCount(0);
  // Closed: how each ended; a subject match says so; the owner may reopen.
  await filterLink(page, en.dgn_filter_closed).click();
  const closed = rowOf(waiting, "waitClosed");
  await expect(closed).toContainText(en.lp_closed_replied);
  await expect(closed).toContainText(en.lp_status_closed);
  await expect(buttonOf(waiting, "waitClosed", en.lp_reopen_for)).toBeVisible();
  const matched = rowOf(waiting, "waitMatched");
  await expect(matched).toContainText(en.lp_closed_replied_subject);
  await expect(matched).toContainText(en.lp_matched_subject);
  await expect(rowOf(waiting, "waitView")).toHaveCount(0);

  // Promised: the stated due date, no follow-up count; Due today holds the one due today only.
  await page.goto(PROMISED);
  const promised = regionOf(page, "promised");
  const promise = rowOf(promised, "promView");
  await expect(promise).toContainText(en.lp_reason_promised);
  await expect(promise).toContainText(/Due \d{1,2} \w{3,4} \d{4} \(stated in your mail\)/);
  await expect(promise).not.toContainText("Follow-ups:");
  await expect(buttonOf(promised, "promView", en.lp_later_for)).toHaveCount(0);
  await filterLink(page, en.lp_filter_due).click();
  await expect(rowOf(promised, "promToday")).toBeVisible();
  await expect(rowOf(promised, "promView")).toHaveCount(0);

  // Delegated: the delegate and the forward, with Stop tracking for an owner.
  await page.goto("/delegations");
  const delegated = regionOf(page, "delegated");
  const forward = rowOf(delegated, "delView");
  await expect(forward).toContainText(E2E_OPEN_LOOPS_DELEGATE.name);
  await expect(forward).toContainText(E2E_OPEN_LOOPS_DELEGATE.email);
  await expect(forward).toContainText(/You forwarded this to a delegate; no answer for/);
  await expect(buttonOf(delegated, "delView", en.lp_untrack_for)).toBeVisible();
  expect(errors).toEqual([]);
});

test("T8: Delegated shows the delegation columns and the tracked loops with their own filter links; Stop tracking asks first", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegations");
  // The columns: each seeded delegation sits in the column of its status.
  const columnList = (title: string) => page.getByRole("list", { name: title, exact: true }).getByRole("listitem");
  await expect(columnList(en.dgn_col_sent).filter({ hasText: E2E_DELEGATIONS.sent.delegateName })).toBeVisible();
  await expect(
    columnList(en.dgn_col_answered).filter({ hasText: E2E_DELEGATIONS.answered.delegateName })
  ).toBeVisible();
  // The loops follow under their heading, with the filter links of the loops.
  const delegated = regionOf(page, "delegated");
  await expect(delegated.getByRole("heading", { name: en.lp_list_delegated })).toBeVisible();
  await expect(rowOf(delegated, "delUntrack")).toBeVisible();
  await expect(filterLink(page, en.dgn_filter_open)).toHaveAttribute("aria-current", "page");
  await expect(filterLink(page, en.dgn_filter_closed)).toHaveAttribute(
    "href",
    "/delegations?tab=delegated&filter=closed"
  );
  await expect(page.getByRole("button", { name: en.dgn_closed_show })).toHaveAttribute("aria-expanded", "false");

  // Stop tracking: Keep returns the focus to the button, Escape does the same, Confirm closes the loop.
  const untrack = buttonOf(delegated, "delUntrack", en.lp_untrack_for);
  await untrack.click();
  const dialog = confirmDialog(page, en.lp_untrack_title);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(fill(en.lp_untrack_text, nameOf("delUntrack")));
  await expect(dialog.getByRole("button", { name: en.lp_keep })).toBeFocused();
  await dialog.getByRole("button", { name: en.lp_keep }).click();
  await expect(dialog).toHaveCount(0);
  await expect(untrack).toBeFocused();
  await expect(rowOf(delegated, "delUntrack")).toBeVisible();
  await untrack.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(untrack).toBeFocused();
  await untrack.click();
  await dialog.getByRole("button", { name: en.lp_untrack_confirm }).click();
  await expect(dialog).toHaveCount(0);
  await expect(statusOf(delegated)).toContainText(en.lp_ok_untrack);
  await expect(statusOf(delegated)).toBeFocused();
  await expect(rowOf(delegated, "delUntrack")).toHaveCount(0);
  await expect(rowOf(delegated, "delView")).toBeVisible();
  // The loop filter link changes the loops; the closed delegations stay shut (the address is read once, at load).
  await filterLink(page, en.dgn_filter_closed).click();
  await expect(page).toHaveURL(/tab=delegated&filter=closed$/);
  await expect(rowOf(delegated, "delUntrack")).toContainText(en.lp_closed_untracked);
  await expect(
    rowOf(delegated, "delUntrack").getByRole("button", { name: fill(en.lp_reopen_for, nameOf("delUntrack")) })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: en.dgn_closed_show })).toHaveAttribute("aria-expanded", "false");
  expect(errors).toEqual([]);
});

test("?tab=delegated&filter=closed shows the closed loops and opens the closed delegations", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  await page.goto("/delegations?tab=delegated&filter=closed");
  await expect(filterLink(page, en.dgn_filter_closed)).toHaveAttribute("aria-current", "page");
  await expect(rowOf(regionOf(page, "delegated"), "delClosed")).toBeVisible();
  await expect(page.getByRole("button", { name: en.dgn_closed_hide })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { level: 2, name: en.dgn_col_closed, exact: true })).toBeVisible();
  // The columns stay above it.
  await expect(page.getByRole("heading", { level: 2, name: en.dgn_col_sent, exact: true })).toBeVisible();
});

test("T5: Waiting, Draft follow-up: Follow-up drafted with a link to the approval; the row then waits for the approval", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(WAITING);
  const waiting = regionOf(page, "waiting");
  await expect(rowOf(waiting, "waitDraft")).toBeVisible();
  await buttonOf(waiting, "waitDraft", en.lp_follow_up_for).click();
  await expect(statusOf(waiting)).toContainText(en.lp_ok_follow_up);
  await expect(statusOf(waiting).getByRole("link", { name: en.lp_follow_up_link })).toHaveAttribute(
    "href",
    /^\/approvals\?id=[0-9a-f-]{36}$/
  );
  // The focus is on the result line, not lost on the page start.
  await expect(statusOf(waiting)).toBeFocused();
  // After the reload the row waits for the approval; Draft follow-up is gone and a second press cannot plan a second follow-up.
  const row = rowOf(waiting, "waitDraft");
  await expect(row).toContainText(en.lp_follow_up_waits);
  await expect(buttonOf(waiting, "waitDraft", en.lp_follow_up_for)).toHaveCount(0);
  const link = await row.getByRole("link", { name: en.lp_follow_up_link }).getAttribute("href");
  const sendId = new URL(link ?? "", "http://x").searchParams.get("id") ?? "";
  expect(sql(`select count(*) from actions where loop_id = '${org().loopIds.waitDraft}' and type = 'send'`)).toBe("1");
  expect(sql(`select status from actions where id = '${sendId}'`)).toBe("awaiting_approval");
  // The link opens the follow-up on the approvals page.
  await row.getByRole("link", { name: en.lp_follow_up_link }).click();
  await expect(page).toHaveURL(new RegExp(`/approvals\\?id=${sendId}$`));
  await expect(page.getByRole("region", { name: en.appr_detail_label })).toBeVisible();
  expect(errors).toEqual([]);
});

test("T6: Waiting, Later moves the due date three working days on", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(WAITING);
  const waiting = regionOf(page, "waiting");
  const row = rowOf(waiting, "waitLater");
  await expect(row).toBeVisible();
  const before = (await dueOf(row).textContent()) ?? "";
  await buttonOf(waiting, "waitLater", en.lp_later_for).click();
  const after = (await dueOf(row).textContent()) ?? "";
  await expect.poll(async () => (await dueOf(rowOf(waiting, "waitLater")).textContent()) ?? "").not.toBe(before);
  const date =
    /Due (\d{1,2} \w{3,4} \d{4})/.exec((await dueOf(rowOf(waiting, "waitLater")).textContent()) ?? "")?.[1] ?? "";
  expect(date).not.toBe("");
  expect(after).not.toBe("");
  await expect(statusOf(waiting)).toContainText(en.lp_ok_later.replace("{date}", date));
  await expect(statusOf(waiting)).toBeFocused();
  expect(sql(`select later_count from open_loops where id = '${org().loopIds.waitLater}'`)).toBe("1");
  expect(errors).toEqual([]);
});

test("T7: Promised, Done: the row leaves Open and shows under Closed with its reason", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(PROMISED);
  const promised = regionOf(page, "promised");
  await expect(rowOf(promised, "promDone")).toBeVisible();
  await buttonOf(promised, "promDone", en.lp_done_for).click();
  await expect(statusOf(promised)).toContainText(en.lp_ok_done);
  await expect(statusOf(promised)).toBeFocused();
  await expect(rowOf(promised, "promDone")).toHaveCount(0);
  await expect(rowOf(promised, "promView")).toBeVisible();
  await filterLink(page, en.dgn_filter_closed).click();
  const done = rowOf(promised, "promDone");
  await expect(done).toContainText(en.lp_closed_done);
  await expect(done.getByRole("button", { name: fill(en.lp_done_for, nameOf("promDone")) })).toHaveCount(0);
  await expect(done.getByRole("button", { name: fill(en.lp_reopen_for, nameOf("promDone")) })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Drop asks first: Keep changes nothing, Confirm closes the loop as dropped", async ({ context, page }) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto(WAITING);
  const waiting = regionOf(page, "waiting");
  const drop = buttonOf(waiting, "waitDrop", en.lp_drop_for);
  await drop.click();
  const dialog = confirmDialog(page, en.lp_drop_title);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(fill(en.lp_drop_text, nameOf("waitDrop")));
  await dialog.getByRole("button", { name: en.lp_keep }).click();
  await expect(drop).toBeFocused();
  await expect(rowOf(waiting, "waitDrop")).toContainText(en.lp_status_open);
  await drop.click();
  await dialog.getByRole("button", { name: en.lp_drop_confirm }).click();
  await expect(dialog).toHaveCount(0);
  await expect(statusOf(waiting)).toContainText(en.lp_ok_drop);
  await expect(statusOf(waiting)).toBeFocused();
  await expect(rowOf(waiting, "waitDrop")).toHaveCount(0);
  await filterLink(page, en.dgn_filter_closed).click();
  await expect(rowOf(waiting, "waitDrop")).toContainText(en.lp_closed_dropped);
  expect(errors).toEqual([]);
});

test("each 409 answer of an action gives its own text and the focus goes to the result line", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  const codes = [
    ["follow-up", "waiting", en.lp_c_waiting],
    ["follow-up", "too_soon", en.lp_c_too_soon],
    ["follow-up", "suspicious", en.lp_c_suspicious],
    ["follow-up", "drafts_off", en.lp_c_drafts_off],
    ["follow-up", "limit_reached", en.lp_c_follow_up_limit],
    ["follow-up", "closed", en.lp_c_closed],
    ["later", "limit_reached", en.lp_c_later_limit],
    ["later", "closed", en.lp_c_closed],
    ["done", "already", en.lp_c_already_closed],
  ] as const;
  for (const [route, code, text] of codes) {
    await page.goto(WAITING);
    const waiting = regionOf(page, "waiting");
    await expect(rowOf(waiting, "waitView")).toBeVisible();
    await page.route(`**/api/loops/*/${route}`, (request) =>
      request.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: code }) })
    );
    const label = route === "follow-up" ? en.lp_follow_up_for : route === "later" ? en.lp_later_for : en.lp_done_for;
    await buttonOf(waiting, "waitView", label).click();
    await expect(statusOf(waiting)).toContainText(text);
    await expect(statusOf(waiting)).toBeFocused();
    await page.unroute(`**/api/loops/*/${route}`);
  }
  // A 404 says the loop is gone; a 500 gives the general error.
  await page.goto(WAITING);
  const waiting = regionOf(page, "waiting");
  await page.route("**/api/loops/*/done", (request) =>
    request.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) })
  );
  await buttonOf(waiting, "waitView", en.lp_done_for).click();
  await expect(statusOf(waiting)).toContainText(en.lp_gone);
  await page.unroute("**/api/loops/*/done");
  await page.route("**/api/loops/*/done", (request) =>
    request.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal" }) })
  );
  await buttonOf(waiting, "waitView", en.lp_done_for).click();
  await expect(statusOf(waiting)).toContainText(en.error_generic);
});

test("T9: a member sees Later and Done only; the server refuses a member the owner actions", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().member);
  await page.goto(WAITING);
  const waiting = regionOf(page, "waiting");
  await expect(rowOf(waiting, "waitView")).toBeVisible();
  await expect(page.getByText(en.lp_owner_only)).toBeVisible();
  await expect(buttonOf(waiting, "waitView", en.lp_later_for)).toBeVisible();
  await expect(buttonOf(waiting, "waitView", en.lp_done_for)).toBeVisible();
  await expect(rowOf(waiting, "waitView").getByRole("button")).toHaveCount(2);
  await expect(waiting.getByRole("button", { name: new RegExp(`^${en.lp_follow_up}:`) })).toHaveCount(0);
  await expect(waiting.getByRole("button", { name: new RegExp(`^${en.lp_drop}:`) })).toHaveCount(0);
  // The notice of a waiting follow-up and its link stay for a member.
  await expect(rowOf(waiting, "waitPending")).toContainText(en.lp_follow_up_waits);
  await filterLink(page, en.dgn_filter_closed).click();
  await expect(rowOf(waiting, "waitClosed")).toBeVisible();
  await expect(rowOf(waiting, "waitClosed").getByRole("button")).toHaveCount(0);
  await page.goto(PROMISED);
  const promised = regionOf(page, "promised");
  await expect(rowOf(promised, "promView").getByRole("button")).toHaveCount(1);
  await expect(buttonOf(promised, "promView", en.lp_done_for)).toBeVisible();
  await page.goto("/delegations");
  const delegated = regionOf(page, "delegated");
  await expect(buttonOf(delegated, "delView", en.lp_later_for)).toBeVisible();
  await expect(buttonOf(delegated, "delView", en.lp_untrack_for)).toHaveCount(0);
  // The routes refuse the owner actions with 403 before any query.
  const origin = new URL(page.url()).origin;
  for (const action of ["follow-up", "drop", "reopen", "untrack"]) {
    const refused = await page.request.post(`/api/loops/${org().loopIds.waitView}/${action}`, {
      data: {},
      headers: { origin },
    });
    expect(refused.status()).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toBe("owner_only");
  }
  expect(errors).toEqual([]);
});

test("T11: every tab, the Closed filter and the confirm question have no axe violation", async ({ context, page }) => {
  await startSession(context, page, org().owner);
  // Earlier tests moved rows, so a list can be empty: the list or the empty text is the loaded page.
  const loaded = (kind: "waiting" | "promised" | "delegated", empty: string) =>
    regionOf(page, kind).getByRole("list").or(page.getByText(empty)).first();
  for (const [url, kind] of [
    ["/delegations", "delegated"],
    [WAITING, "waiting"],
    [PROMISED, "promised"],
  ] as const) {
    await page.goto(url);
    await expect(loaded(kind, en.lp_empty_open)).toBeVisible();
    await expectNoA11yViolations(page);
    await page.goto(`${url}${url.includes("?") ? "&" : "?"}filter=closed`);
    await expect(loaded(kind, en.lp_empty_closed)).toBeVisible();
    await expectNoA11yViolations(page);
  }
  // With a confirm question open: Drop on a waiting loop, then Stop tracking on a delegated one.
  await page.goto(WAITING);
  await buttonOf(regionOf(page, "waiting"), "waitView", en.lp_drop_for).click();
  await expect(confirmDialog(page, en.lp_drop_title)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press("Escape");
  await page.goto("/delegations");
  await buttonOf(regionOf(page, "delegated"), "delView", en.lp_untrack_for).click();
  await expect(confirmDialog(page, en.lp_untrack_title)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press("Escape");
  // A result line.
  await page.goto(WAITING);
  await buttonOf(regionOf(page, "waiting"), "waitView", en.lp_later_for).click();
  await expect(statusOf(regionOf(page, "waiting"))).toContainText("Moved to");
  await expectNoA11yViolations(page);
  // The phone shows five tabs and the page is the current one; the menu holds the rest.
  const nav = page.getByRole("navigation", { name: en.nav_main });
  await expect(nav.getByRole("link", { name: en.nav_open_loops })).toHaveCount(1);
  await expect(nav.getByRole("link", { name: en.nav_delegations, exact: true })).toHaveCount(0);
});

test("the flag open_loops alone: the item and the tabs show, the Delegates header and the delegation columns do not", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  const flag = (enabled: boolean) =>
    sql(`update org_features set enabled = ${enabled} where org_id = '${org().orgId}' and flag = 'delegation_pages'`);
  flag(false);
  try {
    await page.goto("/delegations");
    await expect(page.getByRole("heading", { level: 1, name: en.title_open_loops })).toBeVisible();
    const nav = page.getByRole("navigation", { name: en.nav_main });
    await expect(nav.getByRole("link", { name: en.nav_open_loops })).toHaveAttribute("aria-current", "page");
    // No Delegates header and no delegation columns; the Delegated tab holds the tracked loops with their own filters.
    await expect(page.getByRole("navigation", { name: en.dlg_tabs_label })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: en.dgn_col_sent, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: en.dgn_closed_show })).toHaveCount(0);
    await expect(tabLink(page, en.lp_tab_delegated)).toHaveAttribute("aria-current", "page");
    const delegated = regionOf(page, "delegated");
    await expect(rowOf(delegated, "delView")).toBeVisible();
    await filterLink(page, en.dgn_filter_closed).click();
    await expect(page).toHaveURL(/filter=closed$/);
    await expect(rowOf(delegated, "delClosed")).toBeVisible();
    await expect(rowOf(delegated, "delView")).toHaveCount(0);
    await page.goto(WAITING);
    await expect(rowOf(regionOf(page, "waiting"), "waitView")).toBeVisible();
    await expectNoA11yViolations(page);
    expect(errors).toEqual([]);
  } finally {
    flag(true);
  }
});

// The columns are on the page whatever the delegations specs of the same project moved.
const columnsShown = (page: Page) => page.getByRole("heading", { level: 2, name: en.dgn_col_sent, exact: true });

test("T12: with the flag off the delegations page is unchanged: no loop tabs, the Delegations label, no loops route", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, readSeed().delegationsOrgs[project()].owner);
  await page.goto("/delegations");
  await expect(page.getByRole("heading", { level: 1, name: en.title_delegations })).toBeVisible();
  await expect(columnsShown(page)).toBeVisible();
  await expect(tabsOf(page)).toHaveCount(0);
  await expect(page.getByRole("region", { name: en.lp_list_delegated })).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: en.nav_main });
  await expect(nav.getByRole("link", { name: en.nav_delegations })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: en.nav_open_loops })).toHaveCount(0);
  // `?tab=` means nothing here.
  await page.goto("/delegations?tab=waiting");
  await expect(columnsShown(page)).toBeVisible();
  await expect(tabsOf(page)).toHaveCount(0);
  // The routes answer like for an unknown path.
  const answer = await page.request.get("/api/loops?kind=waiting");
  expect(answer.status()).toBe(404);
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

const detailOf = (page: Page) => page.getByRole("region", { name: en.appr_detail_label });
const editDialog = (page: Page) => page.getByRole("dialog", { name: en.appr_edit_title });
const bodyBox = (page: Page) => editDialog(page).getByRole("textbox", { name: en.appr_edit_body, exact: true });
const saveButton = (page: Page) => editDialog(page).getByRole("button", { name: en.save, exact: true });
const approvalStatus = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

// The page reloads its list every 30 s while it is visible; a `visibilitychange` event runs the same reload at once.
async function reloadApprovals(page: Page): Promise<void> {
  const reloaded = page.waitForResponse((response) => /\/api\/approvals(\?|$)/.test(response.url()));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await reloaded;
}

// A follow-up whose loop closes while Edit is open. The reload keeps the dialog and the typed text; Save closes
// the dialog, says why (the loop is closed, or the send expired with it), puts the focus on the result line and plans no new version.
for (const [name, closeIt] of [
  ["the loop is closed in the database (the send still waits)", "database"],
  ["the owner drops the loop (the send expires with it)", "drop"],
] as const) {
  test(`S11: a follow-up whose loop closes while Edit is open: ${name}`, async ({ context, page }) => {
    const errors = await startSession(context, page, org().owner);
    const sendId = closeIt === "database" ? org().s11ClosedSendId : org().s11DroppedSendId;
    const loopId = closeIt === "database" ? org().loopIds.s11Closed : org().loopIds.s11Dropped;
    await page.goto(`/approvals?id=${sendId}`);
    await detailOf(page).getByRole("button", { name: en.appr_edit }).click();
    await expect(editDialog(page)).toBeVisible();
    await bodyBox(page).fill("S11 typed text");
    if (closeIt === "database") {
      sql(`update open_loops set status = 'closed', close_reason = 'done', closed_at = now() where id = '${loopId}'`);
    } else {
      const origin = new URL(page.url()).origin;
      const dropped = await page.request.post(`/api/loops/${loopId}/drop`, { data: {}, headers: { origin } });
      expect(dropped.status()).toBe(200);
      expect(sql(`select status from actions where id = '${sendId}'`)).toBe("expired");
    }
    await reloadApprovals(page);
    // The reload does not close the dialog or empty the box.
    await expect(editDialog(page)).toBeVisible();
    await expect(bodyBox(page)).toHaveValue("S11 typed text");
    await expectNoA11yViolations(page);
    await saveButton(page).click();
    await expect(editDialog(page)).toHaveCount(0);
    // The send still waits in the first case: the loop-closed text. After the drop the send is `expired`: the text of that state.
    const closedText = closeIt === "database" ? en.appr_closed_loop_closed : en.appr_closed_expired;
    await expect(approvalStatus(page, closedText)).toBeVisible();
    await expect(approvalStatus(page, closedText)).toBeFocused();
    expect(sql(`select count(*) from actions where supersedes_action_id = '${sendId}'`)).toBe("0");
    await expectNoA11yViolations(page);
    expect(errors).toEqual([]);
  });
}
