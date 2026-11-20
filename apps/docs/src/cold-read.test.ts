import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { publicClaims } from "./security/claims";

const DOCS = join(import.meta.dir, "..");
const text = readFileSync(join(DOCS, "cold-read.md"), "utf8");
const CONTENT_DIR = join(import.meta.dir, "content/docs");

// The table rows of the questions: `| <number> | <question> | <expected source> |`.
const rows = [...text.matchAll(/^\| (\d+)\s+\| ([^|]+?)\s+\| (.+?) \|$/gm)].map((match) => ({
  number: Number(match[1]),
  question: match[2] ?? "",
  expected: match[3] ?? "",
}));

describe("the cold-read pack for the built docs site", () => {
  test("it lists the ten buyer questions in order, each with an expected source", () => {
    expect(rows.map((row) => row.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const row of rows) {
      expect(row.question.endsWith("?"), `question ${row.number}`).toBe(true);
      expect(row.expected, `source of question ${row.number}`).toMatch(/`(claim|page):/);
    }
  });

  test("every claim id that it names exists in publicClaims", () => {
    const named = [...text.matchAll(/`claim:([a-z0-9-]+)`/g)].map((match) => match[1] as string);
    expect(named.length).toBeGreaterThan(0);
    const known = publicClaims.map((claim) => claim.id);
    for (const id of named) expect(known, `claim id ${id}`).toContain(id);
  });

  test("every page id that it names is an English page of the site", () => {
    const named = [...text.matchAll(/`page:([a-z0-9/-]+)`/g)].map((match) => match[1] as string);
    expect(named.length).toBeGreaterThan(0);
    for (const id of named) {
      const found = existsSync(join(CONTENT_DIR, `${id}.mdx`)) || existsSync(join(CONTENT_DIR, id, "index.mdx"));
      expect(found, `page id ${id}`).toBe(true);
    }
  });

  test("questions 5 and 6 expect the section 'does not promise', and question 10 the tutorial until a video is published", () => {
    for (const number of [5, 6]) {
      expect(rows[number - 1]?.expected, `question ${number}`).toContain("What this product does not promise");
    }
    const ten = rows[9]?.expected ?? "";
    expect(ten).toContain("`page:start`");
    expect(ten).toContain("While no video is published");
  });

  test("it tells the scout to read only the built HTML in apps/docs/dist/ and names the build command", () => {
    expect(text).toContain("Read only the built HTML in `apps/docs/dist/`");
    expect(text).toContain("`bun run docs:build`");
    expect(text).toContain("Follow `apps/docs/cold-read.md`.");
  });

  test("the pack lives outside the content folder, so it is no page", () => {
    expect(existsSync(join(CONTENT_DIR, "cold-read.md"))).toBe(false);
    expect(DOCS.endsWith("apps/docs")).toBe(true);
  });
});
