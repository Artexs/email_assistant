import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { E2E_DELEGATES_ANNA } from "../../../server/src/scripts/e2e-seed-args";
import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { E2E_BASE_URL } from "../env";
import { cspErrors, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The delegates organization of the project (see `e2e-seed.ts`): the flag `delegation_pages` is on, one delegate (Anna Nowak, tag
// `finance`), an owner and a member. The tests change the list, so the tests of a project run in this order: the reads, the add, the
// edit, the switch, then the keyboard path, which adds one more delegate.
test.describe.configure({ mode: "serial" });

const project = (): "mobile" | "desktop" => (test.info().project.name === "mobile" ? "mobile" : "desktop");
const org = () => readSeed().delegatesOrgs[project()];

// Every test signs in once, from its own client address: the login rate limit counts per address. Documentation range 203.0.113.0/24,
// a block per project, away from the blocks of the approvals spec (10–54, 60–74, 110–154, 160–174).
let signIns = 0;
async function startSession(context: BrowserContext, page: Page, user: { email: string; password: string }) {
  signIns += 1;
  await context.setExtraHTTPHeaders({
    "x-forwarded-for": `203.0.113.${(project() === "mobile" ? 40 : 140) + signIns}`,
  });
  const errors = await cspErrors(page);
  await signInAs(page, user);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  return errors;
}

const listOf = (page: Page) => page.getByRole("list", { name: en.dlg_list_label });
const switchName = (name: string) => en.dlg_switch_label.replace("{name}", name);
const editName = (name: string) => en.dlg_edit_for.replace("{name}", name);
const switchOf = (page: Page, name: string) => page.getByRole("switch", { name: switchName(name) });
const editButton = (page: Page, name: string) => page.getByRole("button", { name: editName(name) });
// The row of a delegate: the list item that holds its switch (the tag lists inside a row are lists too).
const rowOf = (page: Page, name: string) =>
  listOf(page)
    .getByRole("listitem")
    .filter({ has: switchOf(page, name) });
// The line of the result (the page announces the result here).
const statusOf = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const addForm = (page: Page) => page.locator('[data-card="add-delegate"]');
const nameField = (page: Page) => addForm(page).getByLabel(en.dlg_name);
const emailField = (page: Page) => addForm(page).getByLabel(en.dlg_email);
const tagsField = (page: Page) => addForm(page).getByLabel(en.dlg_tags);
const addButton = (page: Page) => addForm(page).getByRole("button", { name: en.dlg_add, exact: true });
const editDialog = (page: Page) => page.getByRole("dialog", { name: en.dlg_edit_title });
const offDialog = (page: Page, name: string) =>
  page.getByRole("dialog", { name: en.dlg_off_title.replace("{name}", name) });
const withName = (text: string, name: string) => text.replace("{name}", name);

async function fillAdd(page: Page, values: { name: string; email: string; tags: string }) {
  await nameField(page).fill(values.name);
  await emailField(page).fill(values.email);
  await tagsField(page).fill(values.tags);
  await addButton(page).click();
}

// Presses Tab until the element is focused (the other stops on the way are links and buttons of the page). Only the keyboard moves.
async function tabTo(page: Page, target: Locator, max = 40) {
  for (let step = 0; step < max; step += 1) {
    await page.keyboard.press("Tab");
    if ((await target.count()) > 0 && (await target.first().evaluate((el) => el === document.activeElement))) return;
  }
  await expect(target, `Tab did not reach the element in ${max} steps`).toBeFocused();
}

test("T3: the header tabs show Delegations and Delegates, and Delegates is the current page", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegates");
  await expect(page.getByRole("heading", { level: 1, name: en.title_delegates })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: en.dlg_tabs_label });
  await expect(tabs.getByRole("link", { name: en.dlg_tab_delegations })).toBeVisible();
  await expect(tabs.getByRole("link", { name: en.dlg_tab_delegates })).toHaveAttribute("aria-current", "page");
  await expect(tabs.getByRole("link", { name: en.dlg_tab_delegations })).not.toHaveAttribute("aria-current", "page");
  // Delegates is no nav item.
  await expect(
    page.getByRole("navigation", { name: en.nav_main }).getByRole("link", { name: en.dlg_tab_delegates })
  ).toHaveCount(0);
  // The list: name, address, tag and state of the seeded delegate; the owner sees the form.
  const anna = rowOf(page, E2E_DELEGATES_ANNA.name);
  await expect(anna).toContainText(E2E_DELEGATES_ANNA.email);
  await expect(anna.getByRole("list", { name: en.dlg_tags }).getByRole("listitem")).toHaveText(["finance"]);
  await expect(anna.getByText(en.dlg_state_active, { exact: true })).toBeVisible();
  await expect(switchOf(page, E2E_DELEGATES_ANNA.name)).toBeChecked();
  await expect(addForm(page)).toBeVisible();
  expect(errors).toEqual([]);
});

test("T9: the page, the add form with its errors, the Edit dialog and the turn-off question have no axe violation", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  await page.goto("/delegates");
  await expect(rowOf(page, E2E_DELEGATES_ANNA.name)).toBeVisible();
  await expectNoA11yViolations(page);

  // The add form with an error on each field (the form checks before it asks the server).
  await addButton(page).click();
  await expect(nameField(page)).toBeFocused();
  await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
  await expectNoA11yViolations(page);
  await nameField(page).fill("Axe Person");
  await addButton(page).click();
  await expect(emailField(page)).toBeFocused();
  await expectNoA11yViolations(page);

  await editButton(page, E2E_DELEGATES_ANNA.name).click();
  await expect(editDialog(page)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press("Escape");
  await expect(editDialog(page)).toHaveCount(0);

  await switchOf(page, E2E_DELEGATES_ANNA.name).click();
  await expect(offDialog(page, E2E_DELEGATES_ANNA.name)).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press("Escape");
  await expect(offDialog(page, E2E_DELEGATES_ANNA.name)).toHaveCount(0);
  // Nothing changed: Anna is still on.
  await expect(switchOf(page, E2E_DELEGATES_ANNA.name)).toBeChecked();
});

test("T4: add Piotr Lis and see the row; the same address again shows the exists text under the address field", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegates");
  await expect(rowOf(page, E2E_DELEGATES_ANNA.name)).toBeVisible();

  // The tag field is split at commas, trimmed and lower-cased.
  await fillAdd(page, { name: "Piotr Lis", email: "piotr@example.com", tags: " IT ,, Budget " });
  const piotr = rowOf(page, "Piotr Lis");
  await expect(piotr).toBeVisible();
  await expect(piotr).toContainText("piotr@example.com");
  await expect(piotr.getByRole("list", { name: en.dlg_tags }).getByRole("listitem")).toHaveText(["it", "budget"]);
  await expect(statusOf(page, withName(en.dlg_added, "Piotr Lis"))).toBeVisible();
  // The form is empty again and the cursor is in Name, ready for the next one.
  await expect(nameField(page)).toHaveValue("");
  await expect(nameField(page)).toBeFocused();

  // The same address again (other case): 409 `exists`, shown under the address field; the cursor goes there.
  await fillAdd(page, { name: "Piotr Second", email: "Piotr@Example.com", tags: "" });
  await expect(page.getByText(en.dlg_exists)).toBeVisible();
  await expect(emailField(page)).toBeFocused();
  await expect(emailField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(emailField(page)).toHaveAccessibleDescription(en.dlg_exists);
  await expect(switchOf(page, "Piotr Second")).toHaveCount(0);
  // Typing in the field clears its error.
  await emailField(page).fill("piotr2@example.com");
  await expect(page.getByText(en.dlg_exists)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("T4c: the address of a mailbox of the organization is refused with its own text under the address field (400 mailbox_address)", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegates");
  await expect(rowOf(page, E2E_DELEGATES_ANNA.name)).toBeVisible();
  const before = await listOf(page).getByRole("listitem").count();
  await fillAdd(page, { name: "Own Box", email: org().mailboxAddress.toUpperCase(), tags: "" });
  await expect(page.getByText(en.dlg_mailbox_address)).toBeVisible();
  await expect(emailField(page)).toBeFocused();
  await expect(emailField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(emailField(page)).toHaveAccessibleDescription(en.dlg_mailbox_address);
  await expect(switchOf(page, "Own Box")).toHaveCount(0);
  expect(await listOf(page).getByRole("listitem").count()).toBe(before);
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("T4b: a delegate with no tag shows a word; the add form refuses a blank name and a bad address before it asks the server", async ({
  context,
  page,
}) => {
  await startSession(context, page, org().owner);
  await page.goto("/delegates");
  await expect(rowOf(page, "Piotr Lis")).toBeVisible();

  await addButton(page).click();
  await expect(nameField(page)).toBeFocused();
  await expect(page.getByText(en.dlg_name_error.replace("{max}", "100"))).toBeVisible();
  await nameField(page).fill("No Tags");
  await emailField(page).fill("not-an-address");
  await addButton(page).click();
  await expect(emailField(page)).toBeFocused();
  await expect(page.getByText(en.dlg_email_error)).toBeVisible();
  await emailField(page).fill("notags@example.com");
  await addButton(page).click();
  const row = rowOf(page, "No Tags");
  await expect(row).toBeVisible();
  await expect(row.getByText(en.dlg_tags_none, { exact: true })).toBeVisible();
  await expect(row.getByRole("list", { name: en.dlg_tags })).toHaveCount(0);
});

test("T5: edit Anna's name; the address shows read only; the list shows the new name and the focus returns to Edit", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegates");
  await editButton(page, E2E_DELEGATES_ANNA.name).click();
  const dialog = editDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(en.dlg_name)).toBeFocused();
  // The address cannot change: it shows read only, with the way to use another one.
  const address = dialog.getByLabel(en.dlg_email);
  await expect(address).toHaveValue(E2E_DELEGATES_ANNA.email);
  await expect(address).not.toBeEditable();
  await expect(address).toHaveAccessibleDescription(en.dlg_edit_address_note);
  // Nothing differs: Save is off.
  await expect(dialog.getByRole("button", { name: en.save })).toBeDisabled();

  await dialog.getByLabel(en.dlg_name).fill("Anna Nowak-Lis");
  await dialog.getByLabel(en.dlg_tags).fill("Finance, legal");
  await dialog.getByRole("button", { name: en.save }).click();
  await expect(dialog).toHaveCount(0);
  const renamed = rowOf(page, "Anna Nowak-Lis");
  await expect(renamed).toBeVisible();
  await expect(renamed.getByRole("list", { name: en.dlg_tags }).getByRole("listitem")).toHaveText(["finance", "legal"]);
  await expect(statusOf(page, withName(en.dlg_saved, "Anna Nowak-Lis"))).toBeVisible();
  await expect(editButton(page, "Anna Nowak-Lis")).toBeFocused();

  // A blank name stays in the dialog with the text under the field and the cursor in the field.
  await editButton(page, "Anna Nowak-Lis").click();
  await dialog.getByLabel(en.dlg_name).fill("   ");
  await dialog.getByRole("button", { name: en.save }).click();
  await expect(dialog.getByText(en.dlg_name_error.replace("{max}", "100"))).toBeVisible();
  await expect(dialog.getByLabel(en.dlg_name)).toBeFocused();
  // Cancel closes it and gives the focus back to the Edit button; the name did not change.
  await dialog.getByRole("button", { name: en.cancel }).click();
  await expect(dialog).toHaveCount(0);
  await expect(editButton(page, "Anna Nowak-Lis")).toBeFocused();
  await expect(rowOf(page, "Anna Nowak-Lis")).toBeVisible();
  expect(errors).toEqual([]);
});

test("T6: turn Piotr off with a question, see Off, turn him on at once and see Active; Cancel keeps the state", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegates");
  const piotr = rowOf(page, "Piotr Lis");
  await expect(piotr.getByText(en.dlg_state_active, { exact: true })).toBeVisible();

  // Cancel: nothing changes and the focus returns to the switch.
  await switchOf(page, "Piotr Lis").click();
  const question = offDialog(page, "Piotr Lis");
  await expect(question).toBeVisible();
  await expect(question).toContainText(en.dlg_off_text);
  await expect(question.getByRole("button", { name: en.cancel })).toBeFocused();
  await question.getByRole("button", { name: en.cancel }).click();
  await expect(question).toHaveCount(0);
  await expect(switchOf(page, "Piotr Lis")).toBeFocused();
  await expect(switchOf(page, "Piotr Lis")).toBeChecked();

  // Confirm: the state shows Off, the result is announced and the focus is on the switch (the row moved below the active ones).
  await switchOf(page, "Piotr Lis").click();
  await question.getByRole("button", { name: en.dlg_off_confirm }).click();
  await expect(question).toHaveCount(0);
  await expect(piotr.getByText(en.dlg_state_off, { exact: true })).toBeVisible();
  await expect(switchOf(page, "Piotr Lis")).not.toBeChecked();
  await expect(statusOf(page, withName(en.dlg_turned_off, "Piotr Lis"))).toBeVisible();
  await expect(switchOf(page, "Piotr Lis")).toBeFocused();
  // The off state survives a reload.
  await page.reload();
  await expect(rowOf(page, "Piotr Lis").getByText(en.dlg_state_off, { exact: true })).toBeVisible();

  // On: at once, no question.
  await switchOf(page, "Piotr Lis").click();
  await expect(rowOf(page, "Piotr Lis").getByText(en.dlg_state_active, { exact: true })).toBeVisible();
  await expect(switchOf(page, "Piotr Lis")).toBeChecked();
  await expect(statusOf(page, withName(en.dlg_turned_on, "Piotr Lis"))).toBeVisible();
  await expect(switchOf(page, "Piotr Lis")).toBeFocused();
  expect(errors).toEqual([]);
});

test("T7: a member sees the list and no form, no Edit button and a disabled switch; the server refuses a member too", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().member);
  await page.goto("/delegates");
  await expect(rowOf(page, "Piotr Lis")).toBeVisible();
  await expect(addForm(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: en.dlg_edit })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit /u })).toHaveCount(0);
  await expect(switchOf(page, "Piotr Lis")).toBeDisabled();
  await expect(page.getByText(en.dlg_owner_only)).toBeVisible();
  await expectNoA11yViolations(page);

  // The page is no gate: a direct request of a member gets 403.
  const origin = new URL(page.url()).origin;
  const add = await page.request.post("/api/delegates", {
    data: { name: "Nobody", email: "nobody@example.com", tags: [] },
    headers: { origin },
  });
  expect(add.status()).toBe(403);
  const list = await page.request.get("/api/delegates");
  expect(list.status()).toBe(200);
  expect(errors).toEqual([]);
});

test("T7b: the owner of a suspended organization sees the list and no form, no Edit button and a disabled switch", async ({
  browser,
}) => {
  // The paused organization (shared, read only) has the flag on and one delegate. Its own browser context and address.
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(project() === "mobile" ? 80 : 180) + 1}` },
    ...(project() === "mobile"
      ? { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true }
      : { viewport: { width: 1280, height: 800 } }),
  });
  try {
    const page = await context.newPage();
    const errors = await cspErrors(page);
    await signInAs(page, readSeed().pausedOwner);
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    await page.goto("/delegates");
    await expect(rowOf(page, E2E_DELEGATES_ANNA.name)).toBeVisible();
    await expect(addForm(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Edit /u })).toHaveCount(0);
    await expect(switchOf(page, E2E_DELEGATES_ANNA.name)).toBeDisabled();
    await expectNoA11yViolations(page);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("T11: a delegate that is gone at the save closes the dialog, says so, and puts the focus on the result line", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegates");
  await expect(rowOf(page, "Piotr Lis")).toBeVisible();
  // The server answers 404 for the save (another owner removed the delegate): the page does not trust its list.
  await page.route("**/api/delegates/*", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 404, json: { error: "not_found" } })
      : route.continue()
  );
  await editButton(page, "Piotr Lis").click();
  await editDialog(page).getByLabel(en.dlg_name).fill("Piotr Gone");
  await editDialog(page).getByRole("button", { name: en.save }).click();
  await expect(editDialog(page)).toHaveCount(0);
  // The text sits in the focused element itself (one live region), and the page has no violation after the answer.
  await expect(page.getByRole("status")).toHaveText(en.dlg_gone);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toBeFocused();
  await expectNoA11yViolations(page);
  await expect(rowOf(page, "Piotr Gone")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("T12: a delegate that is gone at a switch change (no dialog) leaves the page and the focus is on the result line", async ({
  context,
  page,
}) => {
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegates");
  // "No Tags" goes off with the question first (the real server), so that the next change is a turn on: it has no dialog.
  await switchOf(page, "No Tags").click();
  await offDialog(page, "No Tags").getByRole("button", { name: en.dlg_off_confirm }).click();
  await expect(rowOf(page, "No Tags").getByText(en.dlg_state_off, { exact: true })).toBeVisible();

  await page.route("**/api/delegates/*", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 404, json: { error: "not_found" } })
      : route.continue()
  );
  await switchOf(page, "No Tags").click();
  // The text sits in the focused element itself (one live region), and the page has no violation after the answer.
  await expect(page.getByRole("status")).toHaveText(en.dlg_gone);
  await expect(page.getByRole("alert")).toHaveCount(0);
  // The focused switch left the page with its row: the focus is on the line of the result, not on the page start.
  await expect(page.getByRole("status")).toBeFocused();
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("T13: a failed add keeps the focus on Add and shows the general alert (the button is never disabled)", async ({
  context,
  page,
}) => {
  test.skip(project() === "mobile", "the keyboard path runs on the desktop project");
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegates");
  await expect(rowOf(page, "Piotr Lis")).toBeVisible();
  // The server answers after 300 ms with a 500: the request is still running when the next check runs.
  await page.route("**/api/delegates", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise((resolve) => setTimeout(resolve, 300));
    return route.fulfill({ status: 500, json: { error: "internal" } });
  });
  await nameField(page).fill("Failing Person");
  await emailField(page).fill("failing@example.com");
  await tabTo(page, addButton(page));
  await page.keyboard.press("Enter");
  await expect(addButton(page)).toBeFocused();
  await expect(addForm(page).getByRole("alert")).toHaveText(en.error_generic);
  await expect(addButton(page)).toBeFocused();
  await expect(switchOf(page, "Failing Person")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("T8: with the flag off, /delegates shows the flag-off text and no tabs", async ({ browser }) => {
  // The main organization has no `delegation_pages` flag. Its own browser context and address.
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "x-forwarded-for": `203.0.113.${(project() === "mobile" ? 90 : 190) + 1}` },
    ...(project() === "mobile"
      ? { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true }
      : { viewport: { width: 1280, height: 800 } }),
  });
  try {
    const page = await context.newPage();
    const errors = await cspErrors(page);
    await signInAs(page, readSeed().owner);
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    await page.goto("/delegates");
    await expect(page.getByText(en.dlg_off)).toBeVisible();
    await expect(page.getByRole("navigation", { name: en.dlg_tabs_label })).toHaveCount(0);
    await expect(addButton(page)).toHaveCount(0);
    await expectNoA11yViolations(page);
    // The API answers like for an unknown path, for the owner too.
    expect((await page.request.get("/api/delegates")).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("T10: the keyboard alone adds a delegate, edits it, turns it off after the question and on again", async ({
  context,
  page,
}) => {
  test.skip(project() === "mobile", "the keyboard path runs on the desktop project");
  const errors = await startSession(context, page, org().owner);
  await page.goto("/delegates");
  await expect(rowOf(page, "Piotr Lis")).toBeVisible();

  // Tab reaches Name, then Address, then Tags; Enter in a field submits the form. The cursor returns to Name.
  await tabTo(page, nameField(page));
  await page.keyboard.type("Marta Kowal");
  await page.keyboard.press("Tab");
  await expect(emailField(page)).toBeFocused();
  await page.keyboard.type("marta@example.com");
  await page.keyboard.press("Tab");
  await expect(tagsField(page)).toBeFocused();
  await page.keyboard.type("hr");
  await page.keyboard.press("Enter");
  await expect(rowOf(page, "Marta Kowal")).toBeVisible();
  await expect(nameField(page)).toBeFocused();
  await expect(statusOf(page, withName(en.dlg_added, "Marta Kowal"))).toBeVisible();

  // Tab reaches the Edit button of the new row; Enter opens the dialog with the cursor in Name; Escape closes it and the focus returns.
  await tabTo(page, editButton(page, "Marta Kowal"));
  await page.keyboard.press("Enter");
  await expect(editDialog(page)).toBeVisible();
  await expect(editDialog(page).getByLabel(en.dlg_name)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(editDialog(page)).toHaveCount(0);
  await expect(editButton(page, "Marta Kowal")).toBeFocused();

  // Tab reaches the switch; Space asks; the focus is on Cancel; Tab reaches "Turn off"; Enter turns the delegate off.
  await tabTo(page, switchOf(page, "Marta Kowal"));
  await page.keyboard.press("Space");
  const question = offDialog(page, "Marta Kowal");
  await expect(question.getByRole("button", { name: en.cancel })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(question.getByRole("button", { name: en.dlg_off_confirm })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(question).toHaveCount(0);
  await expect(rowOf(page, "Marta Kowal").getByText(en.dlg_state_off, { exact: true })).toBeVisible();
  // The row moved below the active ones; the focus is still on its switch.
  await expect(switchOf(page, "Marta Kowal")).toBeFocused();

  // Space turns it on at once; the focus stays on the switch.
  await page.keyboard.press("Space");
  await expect(rowOf(page, "Marta Kowal").getByText(en.dlg_state_active, { exact: true })).toBeVisible();
  await expect(switchOf(page, "Marta Kowal")).toBeFocused();
  await expectNoA11yViolations(page);
  expect(errors).toEqual([]);
});

test("a delegate with a long address and a long name leaves no sideways scroll", async ({ context, page }) => {
  await startSession(context, page, org().owner);
  await page.goto("/delegates");
  await expect(rowOf(page, E2E_DELEGATES_ANNA.name)).toBeVisible();
  const longName = "Longname".repeat(8);
  await fillAdd(page, { name: longName, email: `${"a".repeat(48)}@example.com`, tags: "finance" });
  await expect(rowOf(page, longName)).toBeVisible();
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
  await expectNoA11yViolations(page);
});
