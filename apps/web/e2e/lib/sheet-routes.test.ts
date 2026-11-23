import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { emptySheetDir, sheetDir, sheetRouteFilter } from "../ui-sheet/dir";
import {
  SHEET_ROUTES,
  SHEET_SKIP,
  SHEET_STATES,
  duplicateSheetNames,
  resolveSheetPath,
  sheetRowProblems,
} from "../ui-sheet/routes";
import { en } from "../../src/i18n/en";

const PAGES = join(import.meta.dirname, "../../src/pages");

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".astro"))
    .map((file) => join(dir, file));
}

describe("the route table of the contact sheet", () => {
  test("every page file of src/pages has a row or a skip reason", () => {
    expect(sheetRowProblems(pageFiles(PAGES))).toEqual([]);
  });

  test("a page file with no row is reported by its path", () => {
    expect(sheetRowProblems([`${PAGES}/activity.astro`, `${PAGES}/new.astro`])).toEqual(["no sheet row: /new"]);
  });

  test("a dynamic page is covered by a row under its folder, and a skip entry covers its path", () => {
    const routes = [{ name: "a", path: "/legal/en/privacy", state: "public", ready: null, open: null }] as const;
    expect(sheetRowProblems([`${PAGES}/legal/[lang]/[doc].astro`, `${PAGES}/operator.astro`], routes, {})).toEqual([
      "no sheet row: /operator",
    ]);
    expect(sheetRowProblems([`${PAGES}/operator.astro`], [], { "/operator": "no operator user" })).toEqual([]);
  });

  test("row names are unique", () => {
    expect(duplicateSheetNames()).toEqual([]);
    expect(duplicateSheetNames([...SHEET_ROUTES, SHEET_ROUTES[0]])).toEqual([SHEET_ROUTES[0].name]);
  });

  test("every row uses a known state, a heading key and a button key that exist, and every skip has a reason", () => {
    for (const route of SHEET_ROUTES) {
      expect(SHEET_STATES).toContain(route.state);
      for (const key of [route.ready, route.open]) if (key !== null) expect(en).toHaveProperty(key);
    }
    for (const reason of Object.values(SHEET_SKIP)) expect(reason.length).toBeGreaterThan(10);
  });

  test("a placeholder takes the id of the seed, and a missing id throws", () => {
    expect(resolveSheetPath("/approvals?id={waitingSendId}", { waitingSendId: "abc" })).toBe("/approvals?id=abc");
    expect(() => resolveSheetPath("/approvals?id={waitingSendId}", {})).toThrow("sheet_path_id_missing waitingSendId");
  });
});

describe("the folder of a run", () => {
  test("the default folder is named for the job, or local", () => {
    expect(sheetDir({ HOME: "/h", LIMEN_JOB_ID: "job-1" }).endsWith("/ui-sheet/job-1")).toBe(true);
    expect(sheetDir({}).endsWith("/ui-sheet/local")).toBe(true);
    expect(sheetDir({ UI_SHEET_DIR: "/tmp/x" })).toBe("/tmp/x");
  });

  test("UI_SHEET_ROUTES gives the names; an empty value gives all", () => {
    expect(sheetRouteFilter({ UI_SHEET_ROUTES: "a, b" })).toEqual(["a", "b"]);
    expect(sheetRouteFilter({ UI_SHEET_ROUTES: " " })).toBeNull();
    expect(sheetRouteFilter({})).toBeNull();
  });

  test("emptying removes the index and the state folders, and keeps any other file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ui-sheet-test-"));
    mkdirSync(join(dir, "main"));
    writeFileSync(join(dir, "main", "a.png"), "x");
    writeFileSync(join(dir, "index.html"), "x");
    writeFileSync(join(dir, "keep.txt"), "x");
    emptySheetDir(dir);
    expect(readdirSync(dir)).toEqual(["keep.txt"]);
  });
});
