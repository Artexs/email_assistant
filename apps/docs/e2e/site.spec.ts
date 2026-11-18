import { expect, test, type Page } from "@playwright/test";

import { DOCS_BASE } from "@ea/core";

import { expectNoA11yViolations } from "./a11y";
import { builtPagePaths, distIsBuilt, docsTestOrigin } from "./site";

// The browser check of the built docs site. The page list comes from the built `.html` files, not from a hand list.
// With `DOCS_TEST_URL` the tests open that site; the list still comes from the local `dist` (build the same commit first).
if (!distIsBuilt()) {
  throw new Error("apps/docs/dist/index.html is missing: run `bun run docs:build` before `bun run docs:test`");
}

const ORIGIN = docsTestOrigin();
const PAGES = builtPagePaths();

interface Watch {
  // `securitypolicyviolation` events and console errors that name the Content Security Policy.
  violations: string[];
  pageErrors: string[];
}

// The init script runs before any script of the page: a violation during load is seen too.
async function watch(page: Page): Promise<Watch> {
  const seen: Watch = { violations: [], pageErrors: [] };
  await page.exposeFunction("reportCspViolation", (text: string) => seen.violations.push(text));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      void (window as unknown as { reportCspViolation: (text: string) => void }).reportCspViolation(
        `${event.violatedDirective} ${event.blockedURI}`
      );
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) {
      seen.violations.push(`console ${message.text().slice(0, 200)}`);
    }
  });
  page.on("pageerror", (error) => seen.pageErrors.push(error.message));
  return seen;
}

async function open(page: Page, path: string) {
  const response = await page.goto(`${ORIGIN}${path}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  return response;
}

test("the page list is not empty and holds both languages", () => {
  expect(PAGES.length).toBeGreaterThan(0);
  expect(PAGES).toContain(`${DOCS_BASE}/`);
  expect(PAGES).toContain(`${DOCS_BASE}/pl/`);
});

test.describe("every built page", () => {
  for (const path of PAGES) {
    test(`T1 ${path} has no CSP violation and no page error`, async ({ page }) => {
      const seen = await watch(page);
      const response = await open(page, path);
      expect(response?.status()).toBe(200);
      expect(seen.violations, "CSP violations").toEqual([]);
      expect(seen.pageErrors, "page errors").toEqual([]);
    });

    test(`T4 ${path} has no accessibility violation`, async ({ page }) => {
      await open(page, path);
      await expectNoA11yViolations(page);
    });
  }
});

test("T2 search finds the operator page", async ({ page }) => {
  const seen = await watch(page);
  await open(page, `${DOCS_BASE}/`);
  await page.locator("button[data-open-modal]").click();
  await page.keyboard.type("install");
  const results = page.locator("dialog[open] .pagefind-ui__result");
  await expect(results.first()).toBeVisible({ timeout: 5_000 });
  expect(await results.count()).toBeGreaterThan(0);
  expect(seen.violations, "CSP violations").toEqual([]);
  expect(seen.pageErrors, "page errors").toEqual([]);
});

test("T2 the Ctrl+K shortcut still opens the search", async ({ page }) => {
  await open(page, `${DOCS_BASE}/`);
  await page.keyboard.press("Control+k");
  await expect(page.locator("dialog[open]")).toBeVisible();
});

test("T3 the English page has lang en and the Polish page has lang pl", async ({ page }) => {
  await open(page, `${DOCS_BASE}/`);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await open(page, `${DOCS_BASE}/pl/`);
  await expect(page.locator("html")).toHaveAttribute("lang", "pl");
});

test("T5 an unknown path answers 404 with the Starlight 404 page", async ({ page }) => {
  const seen = await watch(page);
  const response = await open(page, `${DOCS_BASE}/nope/`);
  expect(response?.status()).toBe(404);
  // The 404 page of Starlight has the site title in its header and a link to the home page.
  await expect(page.locator("header .site-title")).toBeVisible();
  await expect(page.locator("main")).toBeVisible();
  expect(await page.title()).toMatch(/404|not found/i);
  expect(seen.violations, "CSP violations").toEqual([]);
  expect(seen.pageErrors, "page errors").toEqual([]);
});

test("T10 the changelog page shows released versions with a date and no operator text", async ({ page }) => {
  await open(page, `${DOCS_BASE}/changelog/`);
  await expect(page.locator("main h1")).toHaveText("Changelog");
  const headings = await page.locator("main h2").allTextContents();
  expect(headings.length).toBeGreaterThan(0);
  for (const heading of headings) expect(heading).toMatch(/^\d+\.\d+\.\d+ - \d{4}-\d{2}-\d{2}$/);
  expect(headings).toContain("0.1.0 - 2026-11-15");
  const text = await page.locator("main").innerText();
  for (const operatorText of ["Unreleased", "Offline quality lab", "Keep a Changelog", "release:prepare"]) {
    expect(text).not.toContain(operatorText);
  }
});
