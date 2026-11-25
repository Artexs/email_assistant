import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
import { E2E_BASE_URL } from "../env";
import { cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";
import { sheetDir } from "../ui-sheet/dir";

// The delete flow in a real browser: the dialog (focus, errors), the buttons that must not show, the one
// DELETE request, the login notice and the data that must not stay in the page. The spec deletes the organization of its own
// project ("E2E Delete Phone" or "E2E Delete Desktop"), so the tests depend on each other: in this order. The two projects
// run in their own workers, each with its own organization, so the module variables below are per project.
test.describe.configure({ mode: "serial" });

type Project = "mobile" | "desktop";

const projectOf = (name: string): Project => name as Project;
// Free blocks of the `nextAddress` range (the other specs use 10..200 in steps of 10; 50 and 150 are taken too).
const addressBase = (project: string): number => (project === "mobile" ? 0 : 220);

const WRONG_PASSWORD = "e2e-delete-wrong-password-xx";

// Per test: every console line, every request URL, every secret typed into the page, every context opened.
let consoleLines: string[] = [];
let requestUrls: string[] = [];
let typed: string[] = [];
let cspLists: string[][] = [];
let contexts: BrowserContext[] = [];

test.beforeEach(() => {
  consoleLines = [];
  requestUrls = [];
  typed = [];
  cspLists = [];
  contexts = [];
});

test.afterEach(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  // No console line and no URL holds a password or the typed name (the spec checks the page itself where it matters).
  for (const needle of typed) {
    for (const line of [...consoleLines, ...requestUrls]) {
      expect(line.includes(needle), "a console line or a URL holds a typed secret").toBe(false);
    }
  }
  expect(cspLists.flat()).toEqual([]);
});

// Every sign-in runs in a new browser context with its own client address: the login rate limit counts per address.
async function newSession(browser: Browser, project: string, locale?: string): Promise<Page> {
  const context = await browser.newContext({
    baseURL: E2E_BASE_URL,
    extraHTTPHeaders: { "x-forwarded-for": nextAddress(addressBase(project)) },
    ...(locale === undefined ? {} : { locale }),
    // The project's device settings (the phone viewport and touch) reach a new context only when passed on.
    ...(project === "mobile"
      ? { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true }
      : { viewport: { width: 1280, height: 800 } }),
  });
  contexts.push(context);
  const page = await context.newPage();
  page.on("console", (message) => {
    consoleLines.push(message.text());
  });
  page.on("request", (request) => {
    requestUrls.push(request.url());
  });
  cspLists.push(await cspErrors(page));
  return page;
}

// The texts of the language the page speaks: the sign-in labels and the Account card title.
interface PageTexts {
  email_label: string;
  password_label: string;
  sign_in: string;
  acct_sessions_title: string;
}

async function signInAndOpenSettings(
  page: Page,
  user: { email: string; password: string },
  texts: PageTexts = en
): Promise<void> {
  await signInAs(page, user, texts);
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto("/settings");
  await expect(page.locator("[data-card=account]").getByText(texts.acct_sessions_title)).toBeVisible();
}

const DELETE_CARD = "[data-card=delete-organization]";

// The delete card in both colour schemes, saved in the folder of the contact sheet.
async function saveDeleteCard(page: Page, project: string, locale: "en" | "pl"): Promise<void> {
  const folder = join(sheetDir(), "f170-05");
  mkdirSync(folder, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator(DELETE_CARD).screenshot({
      path: join(folder, `delete-card-${project}-${scheme}-${locale}.png`),
      animations: "disabled",
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

const deleteButton = (page: Page): Locator => page.locator(`${DELETE_CARD} [data-action=delete-organization]`);

// True when the focused element is inside the open dialog.
const focusInDialog = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.activeElement?.closest("[role=dialog]") != null);

// What the page keeps of the typed data after an outcome: both storages and every input value (`state`), and the text and
// the markup (`document`). The Account card shows the organization name in its text, so only `state` is checked for the name.
async function pageHolds(page: Page): Promise<{ state: string; document: string }> {
  return page.evaluate(() => ({
    state: JSON.stringify({
      session: { ...sessionStorage },
      local: { ...localStorage },
      inputs: Array.from(document.querySelectorAll("input")).map((input) => input.value),
    }),
    document: `${document.body.innerText}\n${document.documentElement.outerHTML}`,
  }));
}

test("the delete card shows only for the owner with the flag, and it has the danger look", async ({
  browser,
}, testInfo) => {
  const project = projectOf(testInfo.project.name);
  const seed = readSeed();

  // The flag is on in this organization, but an assistant is not the owner.
  const assistantPage = await newSession(browser, project);
  await signInAndOpenSettings(assistantPage, seed.deleteOrgs[project].assistant);
  await expect(assistantPage.locator(DELETE_CARD)).toHaveCount(0);
  await expect(assistantPage.getByRole("button", { name: en.del_title })).toHaveCount(0);

  // The owner of the main seed organization: the flag is off.
  const ownerPage = await newSession(browser, project);
  await signInAndOpenSettings(ownerPage, seed.owner);
  await expect(ownerPage.locator(DELETE_CARD)).toHaveCount(0);
  await expect(ownerPage.getByRole("button", { name: en.del_title })).toHaveCount(0);

  // The owner of the delete organization (flag on): a card of its own, with the button and the danger edge.
  const deleteOwnerPage = await newSession(browser, project);
  await signInAndOpenSettings(deleteOwnerPage, seed.deleteOrgs[project].owner);
  await expect(deleteOwnerPage.locator(DELETE_CARD)).toHaveCount(1);
  await expect(deleteButton(deleteOwnerPage)).toHaveCount(1);
  await expect(
    deleteOwnerPage.locator(DELETE_CARD).getByRole("heading", { level: 2, name: en.del_title })
  ).toBeVisible();
  await expect(deleteOwnerPage.locator(DELETE_CARD)).toHaveAttribute("data-tone", "danger");
  const edge = (selector: string) =>
    deleteOwnerPage.locator(selector).evaluate((card) => getComputedStyle(card).borderTopWidth);
  expect(await edge(DELETE_CARD)).toBe("2px");
  expect(await edge("[data-card=account]")).toBe("0px");
  await saveDeleteCard(deleteOwnerPage, project, "en");
});

test("the dialog traps the focus, returns it, and shows a wrong password in a linked error", async ({
  browser,
}, testInfo) => {
  const project = projectOf(testInfo.project.name);
  const org = readSeed().deleteOrgs[project];
  const page = await newSession(browser, project);
  await signInAndOpenSettings(page, org.owner);
  const trigger = deleteButton(page);
  await expect(trigger).toHaveText(en.del_title);

  const dialog = page.getByRole("dialog");
  const password = dialog.getByLabel(en.del_password_label);
  const name = dialog.getByLabel(en.del_confirm_label);
  const submit = dialog.getByRole("button", { name: en.del_submit });

  // The focus goes into the dialog on open, stays inside on Tab and Shift+Tab, and returns to the button on Escape.
  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(password).toBeFocused();
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press("Tab");
    expect(await focusInDialog(page), `Tab ${step + 1} left the dialog`).toBe(true);
  }
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await focusInDialog(page), `Shift+Tab ${step + 1} left the dialog`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // Cancel returns the focus too, and closing clears the fields.
  await trigger.click();
  await password.fill("typed-then-cancelled");
  await dialog.getByRole("button", { name: en.cancel }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(password).toHaveValue("");
  await expect(name).toHaveValue("");

  // The submit stays off for a wrong name and turns on for the name in lower case (and the password).
  await password.fill(WRONG_PASSWORD);
  typed.push(WRONG_PASSWORD);
  await name.fill("E2E Delete");
  await expect(submit).toBeDisabled();
  await name.fill(org.name.toLowerCase());
  typed.push(org.name.toLowerCase());
  await expect(submit).toBeEnabled();

  // A wrong password: the text, linked from the field, the fields empty, the focus in the password field.
  await submit.click();
  const error = dialog.locator("#del-password-error");
  await expect(error).toHaveText(en.del_wrong_password);
  await expect(password).toHaveAttribute("aria-describedby", "del-password-error");
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(name).not.toHaveAttribute("aria-describedby", /.+/);
  await expect(password).toHaveValue("");
  await expect(name).toHaveValue("");
  await expect(password).toBeFocused();
  const held = await pageHolds(page);
  for (const needle of [WRONG_PASSWORD, org.name.toLowerCase(), org.name]) expect(held.state).not.toContain(needle);
  expect(held.document).not.toContain(WRONG_PASSWORD);
  // The marker of a running delete is gone after a failure.
  expect(await page.evaluate(() => sessionStorage.getItem("ea.deleting"))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem("ea.deleted_mailboxes"))).toBeNull();

  // The organization still loads after the dialog closes.
  await dialog.getByRole("button", { name: en.cancel }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect((await page.request.get("/api/me")).status()).toBe(200);
  await page.reload();
  await expect(page.locator("[data-card=account]").getByText(en.acct_sessions_title)).toBeVisible();
  await expect(deleteButton(page)).toHaveCount(1);
});

test("the Polish panel shows the Polish delete texts", async ({ browser }, testInfo) => {
  const project = projectOf(testInfo.project.name);
  const org = readSeed().deleteOrgs[project];
  const page = await newSession(browser, project, "pl-PL");
  await signInAndOpenSettings(page, org.owner, pl);
  const trigger = page.locator(DELETE_CARD).getByRole("button", { name: "Usuń organizację" });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText(pl.del_title);
  await saveDeleteCard(page, project, "pl");
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: pl.del_title })).toBeVisible();
  await expect(dialog.getByLabel(pl.del_password_label)).toBeVisible();
  await expect(dialog.getByRole("button", { name: pl.del_submit })).toBeDisabled();
});

test("a double click sends one delete request and the login page lists the mailbox once", async ({
  browser,
}, testInfo) => {
  const project = projectOf(testInfo.project.name);
  const org = readSeed().deleteOrgs[project];
  const page = await newSession(browser, project);
  await signInAndOpenSettings(page, org.owner);

  // Count the DELETE requests. The request waits until the test lets it go, so the second click meets a running request.
  let deletes = 0;
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/organization", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    deletes += 1;
    await released;
    await route.continue();
  });

  await deleteButton(page).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(en.del_password_label).fill(org.owner.password);
  typed.push(org.owner.password, org.name);
  await dialog.getByLabel(en.del_confirm_label).fill(org.name);
  await dialog.getByRole("button", { name: en.del_submit }).dblclick();
  // The form is pending: the label changed and the fields are off. Only now the one request goes on.
  await expect(dialog.getByRole("button", { name: en.del_deleting })).toBeDisabled();
  release();

  await expect(page).toHaveURL(/\/login\?deleted=1$/);
  const notice = page.locator("[data-notice=org-deleted]");
  await expect(notice).toHaveCount(1);
  await expect(notice.getByText(en.del_done_title)).toBeVisible();
  await expect(notice.getByText(en.del_done_text)).toBeVisible();
  await expect(notice.getByText(en.del_done_mailboxes)).toBeVisible();
  await expect(notice.getByText(org.mailboxAddress, { exact: true })).toHaveCount(1);
  await expect(notice.locator("li")).toHaveCount(1);
  await expect(page.getByText(en.del_done_text)).toHaveCount(1);
  await expect(page.getByText(org.mailboxAddress)).toHaveCount(1);
  expect(deletes).toBe(1);

  // The notice reads the list once: the key is gone, and so are the password and the typed name.
  expect(await page.evaluate(() => sessionStorage.getItem("ea.deleted_mailboxes"))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem("ea.deleting"))).toBeNull();
  const held = await pageHolds(page);
  for (const needle of [org.owner.password, org.name, org.name.toLowerCase()]) {
    expect(held.state).not.toContain(needle);
    expect(held.document).not.toContain(needle);
  }

  // A reload shows the texts and no address.
  await page.reload();
  await expect(page).toHaveURL(/\/login\?deleted=1$/);
  await expect(page.locator("[data-notice=org-deleted]").getByText(en.del_done_title)).toBeVisible();
  await expect(page.getByText(en.del_done_text)).toHaveCount(1);
  await expect(page.getByText(org.mailboxAddress)).toHaveCount(0);
  await expect(page.locator("[data-notice=org-deleted] li")).toHaveCount(0);
});

test("the deleted owner and the deleted assistant cannot sign in", async ({ browser }, testInfo) => {
  const project = projectOf(testInfo.project.name);
  const org = readSeed().deleteOrgs[project];
  for (const user of [org.owner, org.assistant]) {
    const page = await newSession(browser, project);
    await signInAs(page, user);
    await expect(page.getByRole("alert")).toHaveText(en.login_error_credentials);
    await expect(page).toHaveURL(/\/login$/);
  }
});
