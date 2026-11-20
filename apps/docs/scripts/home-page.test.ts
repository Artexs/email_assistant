import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DOCS_BASE, MINUTE_MS, PRODUCT_NAME } from "@ea/core";

import { publicClaims } from "../src/security/claims";
import { frontMatterValue } from "./stale";

// The built home pages (`/` and `/pl/`) and the link from the built pricing page to the security page.
// The docs build runs into a folder of its own, so `dist` stays as it was (as in `security-page.test.ts`).
const DOCS = join(import.meta.dir, "..");
const WORK_ROOT = join(DOCS, ".dist-home-test");
setDefaultTimeout(MINUTE_MS);

let out = "";
const page = (path: string): string => readFileSync(join(out, path, "index.html"), "utf8");

beforeAll(() => {
  mkdirSync(WORK_ROOT, { recursive: true });
  out = join(mkdtempSync(join(WORK_ROOT, "run-")), "dist");
  const run = Bun.spawnSync(["bun", "run", "build", "--outDir", out], {
    cwd: DOCS,
    env: { ...process.env, NODE_ENV: "production", DOCS_SHOTS: undefined, EA_DOCS_SHOTS_DIR: undefined },
    timeout: 100_000,
  });
  if (run.exitCode !== 0) throw new Error(`docs build failed:\n${run.stdout.toString()}${run.stderr.toString()}`);
});
afterAll(() => rmSync(WORK_ROOT, { recursive: true, force: true }));

const main = (html: string): string => /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
// The text of the page itself: after the h1 and before the footer (it holds the previous and next page links, which are not the page's own).
const content = (html: string): string => /class="sl-markdown-content"[\s\S]*?(?=<footer)/.exec(main(html))?.[0] ?? "";
const decode = (text: string): string => text.replace(/&amp;/g, "&");

// The `href` values of the `<a>` tags of a block, in order.
export function hrefs(block: string): string[] {
  return [...block.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)].map((match) => decode(match[1] ?? ""));
}

// The list items of the section that starts at the `<h2>` with this id (up to the next `<h2>`).
export function sectionItems(html: string, headingId: string): string[] {
  const start = html.indexOf(`<h2 id="${headingId}"`);
  if (start < 0) return [];
  const rest = html.slice(start + 1);
  const next = rest.indexOf("<h2 ");
  const section = next < 0 ? rest : rest.slice(0, next);
  return [...section.matchAll(/<li\b[\s\S]*?<\/li>/g)].map((match) => match[0]);
}

export function itemsWithoutLink(items: readonly string[]): string[] {
  return items.filter((item) => hrefs(item).length === 0);
}

// A link of a page under `pagePath` (for example `/email_assistant/`) resolves to a built file, and its `#id` to an id of that file.
// Returns the links that do not resolve.
export function brokenLinks(dist: string, pagePath: string, links: readonly string[]): string[] {
  return links.filter((link) => {
    const url = new URL(link, `http://page.invalid${pagePath}`);
    if (url.origin !== "http://page.invalid") return false;
    const rel = url.pathname.slice(DOCS_BASE.length).replace(/^\/+/, "");
    const file = [join(dist, rel), join(dist, rel, "index.html"), join(dist, `${rel}.html`)].find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile()
    );
    if (!file) return true;
    return url.hash !== "" && !readFileSync(file, "utf8").includes(`id="${decodeURIComponent(url.hash.slice(1))}"`);
  });
}

const CLAIM_IDS = new Set(publicClaims.map((claim) => claim.id));
const HOMES = [
  {
    lang: "en",
    path: "",
    base: `${DOCS_BASE}/`,
    source: "src/content/docs/index.mdx",
    differentId: "what-is-different",
  },
  {
    lang: "pl",
    path: "pl",
    base: `${DOCS_BASE}/pl/`,
    source: "src/content/docs/pl/index.mdx",
    differentId: "co-jest-inne",
  },
] as const;

describe("the built home pages", () => {
  for (const home of HOMES) {
    describe(home.lang, () => {
      test("1. the h1 is the product name, and the source title is the constant", () => {
        expect(frontMatterValue(readFileSync(join(DOCS, home.source), "utf8"), "title")).toBe(PRODUCT_NAME);
        expect(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(main(page(home.path)))?.[1]).toBe(PRODUCT_NAME);
      });

      test("1. the first link of the main content is the tutorial; security, pricing and start are linked", () => {
        const links = hrefs(content(page(home.path)));
        // Links are relative, so that `security/` under `/pl/` stays in Polish where a page exists.
        expect(links[0]).toBe("start/");
        for (const target of ["start/", "security/", "pricing/"]) expect(links).toContain(target);
      });

      test("2. every item of the list of what is different holds a link; a claim link names a claim of publicClaims", () => {
        const items = sectionItems(content(page(home.path)), home.differentId);
        expect(items.length).toBeGreaterThanOrEqual(4);
        expect(itemsWithoutLink(items)).toEqual([]);
        const claimLinks = items.flatMap(hrefs).filter((link) => link.includes("security/#"));
        expect(claimLinks.length).toBeGreaterThan(0);
        for (const link of claimLinks) {
          expect(CLAIM_IDS.has((/#claim-(.*)$/.exec(link)?.[1] ?? "") as string)).toBe(true);
        }
      });

      test("every same-site link of the page resolves, with its anchor", () => {
        expect(brokenLinks(out, home.base, hrefs(content(page(home.path))))).toEqual([]);
      });

      test("the page does not name an AI provider", () => {
        expect(main(page(home.path))).not.toMatch(/gemini|openai/i);
      });
    });
  }

  test("both pages hold the same links in the same order", () => {
    const [en, pl] = HOMES.map((home) => hrefs(content(page(home.path))).filter((link) => !link.startsWith("#")));
    expect(pl).toEqual(en);
  });
});

describe("the built /pricing/ page", () => {
  test("5. it links to /security/ and the link resolves", () => {
    const links = hrefs(content(page("pricing")));
    expect(links).toContain("../security/");
    expect(brokenLinks(out, `${DOCS_BASE}/pricing/`, ["../security/"])).toEqual([]);
    expect(new URL("../security/", `http://page.invalid${DOCS_BASE}/pricing/`).pathname).toBe(`${DOCS_BASE}/security/`);
  });
});

describe("the checks catch a broken page", () => {
  const item = (inner: string): string => `<li>${inner}</li>`;
  test("a bullet without a link is found", () => {
    const html = `<h2 id="what-is-different">x</h2><ul>${item('<a href="/a/">a</a> text')}${item("no link")}</ul><h2 id="next">y</h2>${item("outside")}`;
    expect(itemsWithoutLink(sectionItems(html, "what-is-different"))).toEqual([item("no link")]);
  });

  test("a link to /securty/ and a link to a missing claim anchor do not resolve", () => {
    expect(brokenLinks(out, `${DOCS_BASE}/`, [`${DOCS_BASE}/securty/`])).toEqual([`${DOCS_BASE}/securty/`]);
    expect(brokenLinks(out, `${DOCS_BASE}/`, [`${DOCS_BASE}/security/#claim-nope`])).toEqual([
      `${DOCS_BASE}/security/#claim-nope`,
    ]);
    expect(
      brokenLinks(out, `${DOCS_BASE}/`, [`${DOCS_BASE}/security/#claim-mail-storage`, "https://example.test/x"])
    ).toEqual([]);
  });

  test("a page that has no link to /security/ is found", () => {
    expect(hrefs('<main><a href="/a/">x</a></main>')).not.toContain(`${DOCS_BASE}/security/`);
  });
});
