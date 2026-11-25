import { expect, test, type Locator, type Page } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { e2eEnv } from "../env";
import { cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The desktop frame: the sidebar card, the user menu, the banner column and the page heading. The spec changes no data.
// Each case signs in once, from its own address (block 450).
interface Account {
  email: string;
  password: string;
}

const OWNER_NAME = "E2E Owner";
const TRANSPARENT = "rgba(0, 0, 0, 0)";

let errors: string[] = [];

test.beforeEach(async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the desktop frame runs on the desktop project");
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(450) });
  errors = await cspErrors(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function startAs(page: Page, user: Account): Promise<void> {
  await signInAs(page, user);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

const sidebar = (page: Page): Locator =>
  page.locator("aside").filter({ has: page.getByRole("navigation", { name: en.nav_main }) });
const activeLink = (page: Page): Locator => sidebar(page).locator("a[aria-current=page]");
const inactiveLink = (page: Page): Locator => sidebar(page).locator("nav a:not([aria-current])").first();

async function openActivity(page: Page, user: Account): Promise<void> {
  await startAs(page, user);
  await page.goto("/activity");
  await expect(activeLink(page)).toBeVisible();
}

test("the sidebar is a rounded card and the active item has the soft teal fill", async ({ page }) => {
  await openActivity(page, readSeed().owner);
  await expect(sidebar(page)).toHaveCSS("border-radius", "28px");
  await expect(activeLink(page)).toHaveCSS("background-color", "rgb(213, 240, 234)");
  await expect(activeLink(page)).toHaveCSS("color", "rgb(10, 117, 104)");
  await expect(inactiveLink(page)).toHaveCSS("background-color", TRANSPARENT);
});

test("the active item has the dark soft fill in the dark scheme", async ({ page }) => {
  await openActivity(page, readSeed().owner);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(activeLink(page)).toHaveCSS("background-color", "rgb(19, 59, 52)");
});

test("the user menu shows the display name, keeps its accessible name and holds the log out item", async ({ page }) => {
  const { owner } = readSeed();
  await openActivity(page, owner);
  const trigger = page.getByRole("button", {
    name: en.user_menu_named.replace("{name}", OWNER_NAME).replace("{email}", owner.email),
  });
  await expect(trigger).toContainText(OWNER_NAME);
  await expect(trigger).toContainText(owner.email);
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: en.log_out })).toBeVisible();
});

test("the sidebar has a 1 px border in forced-colors mode", async ({ page }) => {
  await openActivity(page, readSeed().owner);
  await expect(sidebar(page)).toHaveCSS("border-top-width", "0px");
  await page.emulateMedia({ forcedColors: "active" });
  await expect(sidebar(page)).toHaveCSS("border-top-width", "1px");
});

test("on a short window the user menu stays visible and the page does not scroll", async ({ page }) => {
  const user = readSeed().approvalsOrgs.desktop.owner;
  await page.setViewportSize({ width: 1280, height: 560 });
  await startAs(page, user);
  await page.goto("/approvals");
  // The onboarding item shows while the owner has not finished it: the item list is long.
  await expect(sidebar(page).getByRole("link", { name: en.nav_onboarding })).toBeVisible();
  await expect(page.getByRole("button", { name: en.user_menu })).toBeInViewport({ ratio: 1 });
  const scrolls = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
  expect(scrolls).toBe(false);
});

test("the paused banner starts at the left edge of the page title", async ({ page }) => {
  const contact = e2eEnv().OPERATOR_CONTACT;
  const text =
    contact === undefined || contact === ""
      ? en.paused_banner_no_contact
      : en.paused_banner.replace("{contact}", contact);
  await startAs(page, readSeed().pausedOwner);
  await page.goto("/activity");
  const banner = page.getByRole("status").filter({ hasText: text });
  await expect(banner).toBeVisible();
  const title = page.getByRole("heading", { level: 1 });
  await expect(title).toBeVisible();
  const bannerBox = await banner.boundingBox();
  const titleBox = await title.boundingBox();
  expect(bannerBox?.x).toBe(titleBox?.x);
});

interface Visit {
  path: string;
  title: string;
  user: (project: "desktop") => Account;
}

const VISITS: Visit[] = [
  { path: "/activity", title: en.title_activity, user: () => readSeed().owner },
  { path: "/approvals", title: en.title_approvals, user: (p) => readSeed().approvalsOrgs[p].owner },
  { path: "/delegations", title: en.title_delegations, user: (p) => readSeed().delegationsOrgs[p].owner },
  { path: "/delegates", title: en.title_delegates, user: (p) => readSeed().delegatesOrgs[p].owner },
  { path: "/mailboxes", title: en.title_mailboxes, user: () => readSeed().owner },
  { path: "/settings", title: en.title_settings, user: () => readSeed().owner },
  { path: "/rules", title: en.title_rules, user: () => readSeed().owner },
  { path: "/stats", title: en.title_stats, user: () => readSeed().statsOwner },
  { path: "/onboarding", title: en.title_onboarding, user: () => readSeed().owner },
  { path: "/review", title: en.title_review, user: (p) => readSeed().reviewOrgs[p].owner },
  { path: "/report", title: en.title_report, user: (p) => readSeed().trustOrgs[p].owner },
];

for (const visit of VISITS) {
  test(`${visit.path} has exactly one visible h1 with the page title`, async ({ page }) => {
    await startAs(page, visit.user("desktop"));
    await page.goto(visit.path);
    const headings = page.getByRole("heading", { level: 1 });
    await expect(headings).toHaveCount(1);
    await expect(headings).toHaveText(visit.title);
    await expect(headings).toBeVisible();
  });
}

test("the Activity page has no axe violation", async ({ page }) => {
  await openActivity(page, readSeed().owner);
  await expect(page.getByRole("heading", { level: 1, name: en.title_activity })).toBeVisible();
  await expectNoA11yViolations(page);
});
