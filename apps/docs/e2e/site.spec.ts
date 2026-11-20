import { existsSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { DOCS_BASE, PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH, PRODUCT_NAME } from "@ea/core";

import { blocksWithText, geminiClaimProblems, geminiOutsideCondition } from "../src/gemini-text";
import { OWNER_REVIEW_PENDING } from "../src/publish-gate";
import { publicClaims } from "../src/security/claims";

import { expectNoA11yViolations } from "./a11y";
import { builtPagePaths, distIsBuilt, DOCS_DIST, docsTestOrigin } from "./site";

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

// The new public pages (ticket folder spec/features/active/F121-e10b-public-pages-and-demo): the pages of the publication hold (English ids) and their Polish twins. A Polish twin is a source file `pl/<id>.mdx`.
const CONTENT_DIR = join(import.meta.dirname, "../src/content/docs");
const pageFile = (id: string): boolean =>
  existsSync(join(CONTENT_DIR, `${id}.mdx`)) || existsSync(join(CONTENT_DIR, id, "index.mdx"));
const pagePath = (id: string, prefix: string): string => `${DOCS_BASE}/${prefix}${id === "index" ? "" : `${id}/`}`;
const F121_PAGES = OWNER_REVIEW_PENDING.flatMap((id) => [
  pagePath(id, ""),
  ...(pageFile(`pl/${id}`) ? [pagePath(id, "pl/")] : []),
]);
const WIDTHS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
] as const;

test("F121-12 the new pages are the home, security and pricing pages in both languages and the two reference pages", () => {
  expect(F121_PAGES).toEqual([
    `${DOCS_BASE}/`,
    `${DOCS_BASE}/pl/`,
    `${DOCS_BASE}/security/`,
    `${DOCS_BASE}/pl/security/`,
    `${DOCS_BASE}/pricing/`,
    `${DOCS_BASE}/pl/pricing/`,
    `${DOCS_BASE}/reference/api/`,
    `${DOCS_BASE}/reference/autonomy-evidence/`,
  ]);
  for (const path of F121_PAGES) expect(PAGES, `${path} is built`).toContain(path);
});

test.describe("F121-12 every new page, at desktop and phone width", () => {
  for (const path of F121_PAGES) {
    for (const size of WIDTHS) {
      test(`${path} has no accessibility violation at ${size.name} width`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await open(page, path);
        await expectNoA11yViolations(page);
      });
    }

    // Gemini stays an optional provider, off by default: a block may name it only with that condition, and no page says it is removed.
    test(`${path} names Gemini only as optional and off by default`, async ({ page }) => {
      await open(page, path);
      const html = await page.locator("main").innerHTML();
      expect(geminiOutsideCondition(blocksWithText(html))).toEqual([]);
      expect(geminiClaimProblems(await page.locator("main").innerText())).toEqual([]);
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

test("the security page has its heading, a checklist whose links reach claim anchors, and every claim row", async ({
  page,
}) => {
  await open(page, `${DOCS_BASE}/security/`);
  await expect(page.locator("main h1")).toHaveText("Security and data");
  const links = page.locator('main ul a[href^="#claim-"]');
  const count = await links.count();
  expect(count).toBeGreaterThanOrEqual(5);
  for (let index = 0; index < count; index += 1) {
    const href = (await links.nth(index).getAttribute("href")) ?? "";
    await expect(page.locator(`tr${href}`), `anchor ${href}`).toHaveCount(1);
  }
  await expect(page.locator('main tr[id^="claim-"]').first()).toHaveAttribute("id", "claim-never-sends-alone");
  await expect(page.locator('main tr[id^="subprocessor-"]').first()).toBeVisible();
});

test("F121-03 the pricing page shows the banner, the price and three cost rows, with no form or input", async ({
  page,
}) => {
  await open(page, `${DOCS_BASE}/pricing/`);
  const main = page.locator("main");
  await expect(main).toContainText(
    "Not for sale. This is a placeholder price for a product that is built to a sale standard; there is no checkout."
  );
  await expect(main).toContainText(`$${PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH}`);
  await expect(main.locator("tbody tr")).toHaveCount(3);
  await expect(main.locator("form")).toHaveCount(0);
  await expect(main.locator("input")).toHaveCount(0);
  expect((await main.innerText()).toLowerCase()).not.toContain("gemini");
  await expectNoA11yViolations(page);
});

test("F121-05 the Polish security page shows the Polish text of the first claim, and no Gemini text", async ({
  page,
}) => {
  await open(page, `${DOCS_BASE}/pl/security/`);
  await expect(page.locator("main h1")).toHaveText("Bezpieczeństwo i dane");
  await expect(page.locator("main tr#claim-never-sends-alone td").first()).toHaveText(publicClaims[0]?.text.pl ?? "");
  await expect(page.locator('main tr[id^="subprocessor-"]').first()).toBeVisible();
  expect((await page.locator("main").innerText()).toLowerCase()).not.toContain("gemini");
  await expectNoA11yViolations(page);
});

test("F121-05 the Polish pricing page shows the banner, the price and three cost rows, with no form or input", async ({
  page,
}) => {
  await open(page, `${DOCS_BASE}/pl/pricing/`);
  const main = page.locator("main");
  await expect(main.locator("h1")).toHaveText("Cennik");
  await expect(main).toContainText("Nie na sprzedaż.");
  await expect(main).toContainText(`${PLACEHOLDER_PRICE_USD_PER_MAILBOX_MONTH} USD`);
  await expect(main.locator("tbody tr")).toHaveCount(3);
  await expect(main.locator("form")).toHaveCount(0);
  await expect(main.locator("input")).toHaveCount(0);
  expect((await main.innerText()).toLowerCase()).not.toContain("gemini");
  await expectNoA11yViolations(page);
});

for (const [lang, path] of [
  ["en", `${DOCS_BASE}/`],
  ["pl", `${DOCS_BASE}/pl/`],
] as const) {
  test(`F121-04 the ${lang} home page has the product name as h1, the tutorial as first link, and links to security and pricing`, async ({
    page,
  }) => {
    await open(page, path);
    await expect(page.locator("main h1")).toHaveText(PRODUCT_NAME);
    const links = page.locator("main .sl-markdown-content a[href]");
    await expect(links.first()).toHaveAttribute("href", "start/");
    for (const target of ["start/", "security/", "pricing/"]) {
      await expect(page.locator(`main .sl-markdown-content a[href="${target}"]`).first()).toBeVisible();
    }
  });
}

// The demo video: a build with the three files (the release assets, or the fixtures of `apps/docs/e2e/fixtures`) shows a <video> with two caption
// tracks; a build without them shows none. No playback assert: Playwright's Chromium may lack H.264. The test reads the built folder to know which case it checks.
const DEMO_BUILT = ["demo.mp4", "demo.en.vtt", "demo.pl.vtt"].every((name) =>
  existsSync(join(DOCS_DIST, "demo", name))
);

for (const [lang, path] of [
  ["en", `${DOCS_BASE}/`],
  ["pl", `${DOCS_BASE}/pl/`],
] as const) {
  test(`F121-11 the ${lang} home page ${DEMO_BUILT ? "has the demo video with two caption tracks and no violation" : "has no video: no demo files in the build"}`, async ({
    page,
  }) => {
    const seen = await watch(page);
    await open(page, path);
    const video = page.locator("main video");
    if (!DEMO_BUILT) {
      await expect(video).toHaveCount(0);
      return;
    }
    await expect(video).toHaveCount(1);
    await expect(video).toHaveAttribute("controls", "");
    await expect(video).not.toHaveAttribute("autoplay", /.*/);
    const tracks = video.locator('track[kind="captions"]');
    await expect(tracks).toHaveCount(2);
    await expect(video.locator("track[default]")).toHaveAttribute("srclang", lang);
    // The files answer 200 with a video or caption type, under the site's own origin.
    const sources = [
      (await video.getAttribute("src")) ?? "",
      ...(await tracks.evaluateAll((list) => list.map((item) => item.getAttribute("src") ?? ""))),
    ];
    expect(sources).toHaveLength(3);
    for (const src of sources) {
      const response = await page.request.get(`${ORIGIN}${src}`);
      expect(response.status(), src).toBe(200);
      expect(response.headers()["content-type"], src).toMatch(src.endsWith(".mp4") ? /^video\/mp4/ : /^text\/vtt/);
    }
    expect(seen.violations, "CSP violations").toEqual([]);
    expect(seen.pageErrors, "page errors").toEqual([]);
    await expectNoA11yViolations(page);
  });
}
