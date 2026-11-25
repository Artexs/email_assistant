import { expect, test, type Locator, type Page } from "@playwright/test";

import { phoneTabs } from "../../src/components/shell/nav-items";
import { en } from "../../src/i18n/en";
import { pl } from "../../src/i18n/pl";
import { expectNoA11yViolations } from "../a11y";
import { e2eEnv } from "../env";
import { cspErrors, nextAddress, signInAs } from "../helpers";
import { readSeed } from "../seed";

// The frame: on the desktop project the sidebar card, the user menu, the banner column and the page heading; on the mobile project the
// phone header, the menu sheet and the tab bar. The spec changes no data.
// Each case signs in once, from its own address (block 450).
interface Account {
  email: string;
  password: string;
}

const OWNER_NAME = "E2E Owner";
const TRANSPARENT = "rgba(0, 0, 0, 0)";

async function startAs(page: Page, user: Account): Promise<void> {
  await signInAs(page, user);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("desktop frame", () => {
  let errors: string[] = [];

  test.beforeEach(async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the desktop frame runs on the desktop project");
    await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(450) });
    errors = await cspErrors(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

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

  test("the user menu shows the display name, keeps its accessible name and holds the log out item", async ({
    page,
  }) => {
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
});

test.describe("phone frame", () => {
  let errors: string[] = [];

  test.beforeEach(async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the phone frame runs on the mobile project");
    await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(470) });
    errors = await cspErrors(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  const tabBar = (page: Page): Locator => page.getByRole("navigation", { name: en.nav_main });
  const phoneHeader = (page: Page): Locator =>
    page.locator("header").filter({ has: page.getByRole("button", { name: en.menu_open }) });

  // The seed has a few waiting sends, but a spec of the approvals page may have answered them: the count comes from the answer here.
  async function setWaiting(page: Page, count: number): Promise<void> {
    await page.route("**/api/me", async (route) => {
      const me = (await (await route.fetch()).json()) as { approvalsWaiting: number };
      await route.fulfill({ json: { ...me, approvalsWaiting: count } });
    });
  }

  test("five tabs in the order of the nav items, 64 px high, the active tab teal", async ({ page }) => {
    await startAs(page, readSeed().approvalsOrgs.mobile.owner);
    await page.goto("/approvals");
    const links = tabBar(page).getByRole("link");
    const labels = phoneTabs(["approvals_page", "stats_page"]).map((item) => en[item.label]);
    expect(labels).toHaveLength(5);
    await expect(links).toHaveCount(labels.length);
    // The approvals link adds "N waiting" to its name while drafts wait: the name starts with the label.
    for (const [index, label] of labels.entries()) {
      await expect(links.nth(index)).toHaveAccessibleName(new RegExp(`^${label}`));
    }
    expect((await tabBar(page).boundingBox())?.height).toBe(64);
    const active = tabBar(page).locator("a[aria-current=page]");
    await expect(active).toHaveCount(1);
    await expect(active).toHaveCSS("color", "rgb(10, 117, 104)");
  });

  test("the phone header holds the brand as text and no heading; the page has one h1", async ({ page }) => {
    await startAs(page, readSeed().owner);
    await page.goto("/activity");
    const header = phoneHeader(page);
    await expect(header).toContainText(en.brand);
    await expect(header.getByRole("heading")).toHaveCount(0);
    const headings = page.getByRole("heading", { level: 1 });
    await expect(headings).toHaveCount(1);
    await expect(headings).toHaveText(en.title_activity);
    await expect(headings).toBeVisible();
  });

  test.describe("Polish browser", () => {
    test.use({ locale: "pl-PL" });

    test("the menu sheet holds the overflow item and opens its page", async ({ page }) => {
      await signInAs(page, readSeed().approvalsOrgs.mobile.owner, pl);
      await page.waitForURL((url) => !url.pathname.startsWith("/login"));
      await page.goto("/approvals");
      await page.getByRole("button", { name: pl.menu_open }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      await sheet.getByRole("link", { name: pl.nav_stats }).click();
      await page.waitForURL("**/stats");
    });
  });

  test("the menu sheet shows the person with the name and the email", async ({ page }) => {
    const { owner } = readSeed();
    await startAs(page, owner);
    await page.goto("/activity");
    await page.getByRole("button", { name: en.menu_open }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText(owner.email)).toBeVisible();
    await expect(sheet.getByText("E2E Owner")).toBeVisible();
    await expect(sheet.getByRole("button", { name: en.log_out })).toBeVisible();
  });

  test("at 320 px wide the page does not scroll sideways and the 99+ badge stays in its tab", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await setWaiting(page, 120);
    await startAs(page, readSeed().approvalsOrgs.mobile.owner);
    await page.goto("/activity");
    const tab = tabBar(page).getByRole("link", { name: new RegExp(`^${en.nav_approvals}`) });
    const badge = tab.getByText("99+", { exact: true });
    await expect(badge).toBeVisible();
    const tabBox = await tab.boundingBox();
    const badgeBox = await badge.boundingBox();
    if (tabBox === null || badgeBox === null) throw new Error("the tab and its badge have a box");
    expect(badgeBox.x).toBeGreaterThanOrEqual(tabBox.x);
    expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(tabBox.x + tabBox.width);
    expect(badgeBox.y).toBeGreaterThanOrEqual(tabBox.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    // Every label shows whole: no tab text is wider than its tab.
    const overflowing = await tabBar(page)
      .getByRole("link")
      .evaluateAll((links) => links.filter((link) => link.scrollWidth > link.clientWidth).length);
    expect(overflowing).toBe(0);
  });

  test("the last line of a page is above the tab bar after a scroll to the end", async ({ page }) => {
    await startAs(page, readSeed().owner);
    await page.goto("/settings");
    await expect(page.getByText(en.acct_title, { exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = await page.locator("main > :last-child").boundingBox();
    const bar = await tabBar(page).boundingBox();
    if (last === null || bar === null) throw new Error("main and the tab bar have a box");
    expect(last.y + last.height).toBeLessThanOrEqual(bar.y);
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("the menu sheet does not animate", async ({ page }) => {
      await startAs(page, readSeed().owner);
      await page.goto("/activity");
      await page.getByRole("button", { name: en.menu_open }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      const motion = await sheet.evaluate((node) => {
        const style = getComputedStyle(node);
        return { name: style.animationName, duration: style.animationDuration };
      });
      expect(motion.name === "none" || motion.duration === "0s").toBe(true);
    });
  });

  test("the Activity page has no axe violation on a phone", async ({ page }) => {
    await startAs(page, readSeed().owner);
    await page.goto("/activity");
    await expect(page.getByRole("heading", { level: 1, name: en.title_activity })).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
