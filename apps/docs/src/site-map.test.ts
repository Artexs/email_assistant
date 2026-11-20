import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { IN_PLACE_PAGES } from "./in-place";

const CONTENT_DIR = join(import.meta.dir, "content/docs");

// The id of a source page: the path without its extension. A folder page `x/index` is `x`, as in the Astro collection.
// The home pages keep `index` and `pl/index`: the stale check and the Polish set (`POLISH_SET`) name them so.
function sourcePageId(contentDir: string, file: string): string {
  const id = relative(contentDir, file)
    .replaceAll("\\", "/")
    .replace(/\.mdx?$/, "");
  if (id === "index" || id === "pl/index" || !id.endsWith("/index")) return id;
  return id.slice(0, -"/index".length);
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.mdx?$/.test(name) ? [path] : [];
  });
}

// The source page ids: the files of `src/content/docs` and the in-place pages. Built pages (the `/pl/` fallbacks of Starlight) are not listed.
function sourcePageIds(
  contentDir: string = CONTENT_DIR,
  inPlace: readonly { id: string }[] = IN_PLACE_PAGES
): string[] {
  return [...files(contentDir).map((file) => sourcePageId(contentDir, file)), ...inPlace.map((page) => page.id)].sort();
}

// Each content group adds its ids here (the tutorial and the FAQ, the how-to guides, the `pl/` pages).
const EXPECTED_PAGE_IDS = [
  "changelog",
  "explanation/how-a-mail-is-sorted",
  "explanation/never-sends-alone",
  "explanation/shadow-and-assist",
  "faq",
  "how-to/approve-a-send",
  "how-to/correct-a-category",
  "how-to/delegate-and-follow-up",
  "how-to/digest-times",
  "how-to/language",
  "how-to/mode-and-switches",
  "how-to/pause",
  "how-to/sender-rules",
  "how-to/two-factor",
  "how-to/undo-a-move",
  "index",
  "operate/install-and-run",
  "operate/release-checklist",
  "pl/explanation/how-a-mail-is-sorted",
  "pl/faq",
  "pl/how-to/approve-a-send",
  "pl/how-to/correct-a-category",
  "pl/how-to/delegate-and-follow-up",
  "pl/how-to/digest-times",
  "pl/how-to/language",
  "pl/how-to/mode-and-switches",
  "pl/how-to/pause",
  "pl/how-to/sender-rules",
  "pl/how-to/two-factor",
  "pl/how-to/undo-a-move",
  "pl/index",
  "pl/pricing",
  "pl/security",
  "pl/start",
  "pricing",
  "reference/api",
  "reference/autonomy-evidence",
  "reference/categories",
  "reference/limits",
  "reference/settings",
  "reference/telegram",
  "security",
  "start",
];

describe("site map", () => {
  test("T2 the source pages are exactly the expected ids: a missing or an extra page fails", () => {
    expect(sourcePageIds()).toEqual(EXPECTED_PAGE_IDS);
  });
  test("the expected list is sorted and has no duplicate", () => {
    expect([...EXPECTED_PAGE_IDS].sort()).toEqual(EXPECTED_PAGE_IDS);
    expect(new Set(EXPECTED_PAGE_IDS).size).toBe(EXPECTED_PAGE_IDS.length);
  });
  test("each user page is a sidebar item of astro.config.mjs", () => {
    const config = readFileSync(join(import.meta.dir, "../astro.config.mjs"), "utf8");
    const userPages = EXPECTED_PAGE_IDS.filter(
      (id) => id !== "index" && id !== "changelog" && !id.startsWith("pl/") && !id.startsWith("operate/")
    );
    expect(userPages).toEqual([
      "explanation/how-a-mail-is-sorted",
      "explanation/never-sends-alone",
      "explanation/shadow-and-assist",
      "faq",
      "how-to/approve-a-send",
      "how-to/correct-a-category",
      "how-to/delegate-and-follow-up",
      "how-to/digest-times",
      "how-to/language",
      "how-to/mode-and-switches",
      "how-to/pause",
      "how-to/sender-rules",
      "how-to/two-factor",
      "how-to/undo-a-move",
      "pricing",
      "reference/api",
      "reference/autonomy-evidence",
      "reference/categories",
      "reference/limits",
      "reference/settings",
      "reference/telegram",
      "security",
      "start",
    ]);
    for (const id of userPages)
      expect({ id, listed: config.includes(`{ slug: "${id}" }`) }).toEqual({ id, listed: true });
  });
  test("a folder page `x/index.mdx` has the id `x`; the home page and a Polish home page keep `index`", () => {
    const dir = mkdtempSync(join(tmpdir(), "f112-site-map-"));
    try {
      mkdirSync(join(dir, "start"));
      mkdirSync(join(dir, "pl"));
      mkdirSync(join(dir, "how-to"));
      writeFileSync(join(dir, "index.mdx"), "");
      writeFileSync(join(dir, "pl/index.mdx"), "");
      writeFileSync(join(dir, "start/index.mdx"), "");
      writeFileSync(join(dir, "how-to/two-factor.md"), "");
      writeFileSync(join(dir, "notes.txt"), "");
      expect(sourcePageIds(dir, [{ id: "operate/x" }])).toEqual([
        "how-to/two-factor",
        "index",
        "operate/x",
        "pl/index",
        "start",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("the changelog page is an in-place page built from CHANGELOG.md", () => {
    const page = IN_PLACE_PAGES.find((candidate) => candidate.id === "changelog");
    expect(page?.path).toBe("CHANGELOG.md");
    expect(page?.transform).toBeFunction();
  });
  test("a missing and an extra page differ from the expected list", () => {
    const dir = mkdtempSync(join(tmpdir(), "f112-site-map-"));
    try {
      writeFileSync(join(dir, "index.mdx"), "");
      expect(sourcePageIds(dir, [])).not.toEqual(EXPECTED_PAGE_IDS);
      writeFileSync(join(dir, "extra.mdx"), "");
      expect(sourcePageIds(dir, [])).toContain("extra");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
