import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { en } from "../../src/i18n/en";
import { expectNoA11yViolations } from "../a11y";
import { cspErrors, nextAddress, signInAs } from "../helpers";
import type { ColorScheme } from "../lib/schemes";
import { readSeed } from "../seed";
import { sheetDir } from "../ui-sheet/dir";
import { notices, ORG_IDS, orgDetail, orgList } from "./operator-fixtures";

// The e2e seed has no operator user, so the spec signs in as the seed owner and answers the page and its three reads itself:
// the page file comes from the dev build (`bun run web:build:dev`), the data from `operator-fixtures.ts`. The assets still come
// from the real server. Nothing here changes data: no cleanup. Blocks: 600 and 620.
test.describe.configure({ mode: "serial" });
// The service worker would answer the page request itself, past the route below.
test.use({ serviceWorkers: "block" });

const PAGE_FILE = resolve(import.meta.dirname, "../../dist/operator/index.html");
const VIEWPORTS = { phone: { width: 412, height: 915 }, desktop: { width: 1280, height: 800 } } as const;
const SCHEMES: readonly ColorScheme[] = ["light", "dark"];

let errors: string[] = [];
let planPosts = 0;

// Both schemes on the desktop project, light on the phone project (the phone gives the same colour pairs).
function schemesOf(project: string): ColorScheme[] {
  return project === "desktop" ? ["light", "dark"] : ["light"];
}

async function openOperator(page: Page): Promise<void> {
  await page.route("**/operator", async (route) => {
    // The server answers the not-found page for a user who is not an operator; its headers (CSP) stay, its body is the page file.
    const real = await route.fetch();
    const headers = real.headers();
    delete headers["content-length"];
    delete headers["content-encoding"];
    await route.fulfill({ status: 200, headers, body: readFileSync(PAGE_FILE) });
  });
  await page.route("**/api/operator/orgs", (route) => route.fulfill({ json: orgList }));
  await page.route("**/api/operator/orgs/*", (route) => {
    const orgId = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    return route.fulfill({ json: orgDetail(orgId) });
  });
  await page.route("**/api/operator/orgs/*/plan", (route) => {
    planPosts += 1;
    return route.fulfill({ status: 500, json: { error: "unexpected" } });
  });
  await page.route("**/api/operator/notices**", (route) => route.fulfill({ json: notices }));
  await page.goto("/operator");
  await expect(page.locator('[data-section="orgs"] tbody tr')).toHaveCount(orgList.orgs.length);
  await expect(page.locator('[data-section="notices"] li')).toHaveCount(notices.notices.length);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

test.beforeEach(async ({ context, page }, testInfo) => {
  planPosts = 0;
  await context.setExtraHTTPHeaders({ "x-forwarded-for": nextAddress(testInfo.project.name === "mobile" ? 600 : 620) });
  errors = await cspErrors(page);
  await signInAs(page, readSeed().owner);
  await expect(page).toHaveURL(/\/onboarding$/);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test("the tables show the three organizations and five notices, a tap on a row shows its detail, and the scan passes", async ({
  page,
}, testInfo) => {
  await openOperator(page);
  const rows = page.locator('[data-section="orgs"] tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('[data-section="detail"]')).toContainText(en.op_detail_hint);
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute("data-state", "selected");
  const detail = page.locator('[data-section="detail"]');
  await expect(detail).toContainText(en.op_detail_title.replace("{id}", ORG_IDS[1].slice(0, 8)));
  await expect(detail.locator('[data-section="sso"]')).toBeVisible();
  await expectNoA11yViolations(page, { schemes: schemesOf(testInfo.project.name) });
});

test("the id button of a row selects it with the keyboard", async ({ page }) => {
  await openOperator(page);
  const button = page.locator('[data-section="orgs"] tbody tr').nth(2).getByRole("button");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-section="orgs"] tbody tr').nth(2)).toHaveAttribute("data-state", "selected");
});

test("the tables scroll inside their box at 320 px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openOperator(page);
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
});

test("the plan dialog passes the scan and Cancel sends nothing", async ({ page }, testInfo) => {
  await openOperator(page);
  await page.locator('[data-section="orgs"] tbody tr').nth(1).click();
  await page.getByRole("button", { name: en.op_plan_button }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectNoA11yViolations(page, { include: "[role=dialog]", schemes: schemesOf(testInfo.project.name) });
  await dialog.getByRole("button", { name: en.cancel }).click();
  await expect(dialog).toBeHidden();
  expect(planPosts).toBe(0);
});

test("four pictures of the page are saved in the contact sheet folder", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one project saves the pictures: the sizes are set here");
  const folder = join(sheetDir(), "operator");
  mkdirSync(folder, { recursive: true });
  await openOperator(page);
  await page.locator('[data-section="orgs"] tbody tr').nth(1).click();
  await expect(page.locator('[data-section="detail"] [data-section="sso"]')).toBeVisible();
  for (const [viewport, size] of Object.entries(VIEWPORTS)) {
    for (const scheme of SCHEMES) {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({
        path: join(folder, `operator-${viewport}-${scheme}-en.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  }
});
