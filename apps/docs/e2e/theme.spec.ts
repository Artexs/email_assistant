import { expect, test } from "@playwright/test";

import { DOCS_BASE } from "@ea/core";

import { expectNoA11yViolations } from "./a11y";
import { builtPagePaths, distIsBuilt, docsTestOrigin } from "./site";

// The theme of the docs site: the dark scheme has no accessibility violation, and the body uses the panel font.
// The built site must exist first: `bun run docs:build`.
if (!distIsBuilt()) {
  throw new Error("apps/docs/dist/index.html is missing: run `bun run docs:build` before `bun run docs:test`");
}

const ORIGIN = docsTestOrigin();
const BUILT = new Set(builtPagePaths());

// English page ids; a Polish page is checked where it is built.
const PAGE_IDS = [
  "",
  "start/",
  "how-to/sender-rules/",
  "reference/settings/",
  "explanation/how-a-mail-is-sorted/",
  "faq/",
  "security/",
  "pricing/",
];
const DARK_PAGES = PAGE_IDS.flatMap((id) => [`${DOCS_BASE}/${id}`, `${DOCS_BASE}/pl/${id}`]).filter((path) =>
  BUILT.has(path)
);

async function open(page: import("@playwright/test").Page, path: string): Promise<void> {
  await page.goto(`${ORIGIN}${path}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
}

test("the dark pass covers the eight English pages and their Polish pages", () => {
  const english = DARK_PAGES.filter((path) => !path.startsWith(`${DOCS_BASE}/pl/`));
  expect(english).toHaveLength(PAGE_IDS.length);
  expect(DARK_PAGES.length).toBeGreaterThan(english.length);
});

test.describe("the dark scheme", () => {
  test.use({ colorScheme: "dark" });

  for (const path of DARK_PAGES) {
    test(`${path} has no accessibility violation in the dark scheme`, async ({ page }) => {
      await open(page, path);
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
      await expectNoA11yViolations(page);
    });
  }
});

test("the home page body uses Nunito and the font loads", async ({ page }) => {
  await open(page, `${DOCS_BASE}/`);
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family.startsWith('"Nunito Variable"')).toBe(true);
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('16px "Nunito Variable"');
  });
  expect(loaded).toBe(true);
});
