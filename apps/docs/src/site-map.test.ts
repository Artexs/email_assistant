import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { IN_PLACE_PAGES } from "./in-place";

// The source page ids of the site: the files of `src/content/docs` and the in-place sources. Not the built pages (no `/pl/` fallbacks).
// A content stage adds its ids here; a missing or an extra id fails.
const CONTENT = join(import.meta.dir, "content/docs");

function contentIds(dir: string = CONTENT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return contentIds(path);
    return /\.mdx?$/.test(entry.name) ? [relative(CONTENT, path).replace(/\.mdx?$/, "")] : [];
  });
}

const EXPECTED = ["changelog", "index", "operate/install-and-run", "operate/release-checklist", "pl/index"];

describe("site map", () => {
  test("the source page ids are the expected list", () => {
    const ids = [...contentIds(), ...IN_PLACE_PAGES.map((page) => page.id)].sort();
    expect(ids).toEqual(EXPECTED);
  });

  test("the changelog page is an in-place page built from CHANGELOG.md", () => {
    const page = IN_PLACE_PAGES.find((candidate) => candidate.id === "changelog");
    expect(page?.path).toBe("CHANGELOG.md");
    expect(page?.transform).toBeFunction();
  });
});
