import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkInPlacePages } from "./in-place-check";

const PAGES = [
  { id: "operate/a", path: "deploy/README.md" },
  { id: "operate/b", path: "docs/b.md" },
] as const;

const built = (title: string, id: string) =>
  `<html><body><nav><span class="large">Operate</span><a href="/email_assistant/${id}/" aria-current="page" data-x="1">${title}</a></nav><h1 id="_top" data-astro-cid-x>${title}</h1></body></html>`;

describe("checkInPlacePages", () => {
  let root = "";
  let dist = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "in-place-check-src-"));
    dist = mkdtempSync(join(tmpdir(), "in-place-check-dist-"));
    put(root, "deploy/README.md", "# Alpha & Beta\n\ntext\n");
    put(root, "docs/b.md", "# Bravo\n");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(dist, { recursive: true, force: true });
  });
  const put = (base: string, path: string, text: string) => {
    mkdirSync(dirname(join(base, path)), { recursive: true });
    writeFileSync(join(base, path), text);
  };
  const pass = () => {
    put(dist, "operate/a/index.html", built("Alpha &amp; Beta", "operate/a"));
    put(dist, "operate/b/index.html", built("Bravo", "operate/b"));
  };

  test("T6 each page exists, has the source title as h1 and is the current page of a link in the section Operate", () => {
    pass();
    expect(checkInPlacePages(dist, PAGES, root)).toEqual({ checked: 2 });
  });
  test("a page that is not built fails with missing", () => {
    put(dist, "operate/a/index.html", built("Alpha &amp; Beta", "operate/a"));
    expect(() => checkInPlacePages(dist, PAGES, root)).toThrow("in_place_page operate/b: missing");
  });
  test("a page with another h1 fails with title", () => {
    pass();
    put(dist, "operate/b/index.html", built("Other", "operate/b"));
    expect(() => checkInPlacePages(dist, PAGES, root)).toThrow("in_place_page operate/b: title");
    put(dist, "operate/b/index.html", "<html><body><nav></nav></body></html>");
    expect(() => checkInPlacePages(dist, PAGES, root)).toThrow("in_place_page operate/b: title");
  });
  test("a page that the sidebar does not list fails with sidebar", () => {
    pass();
    put(
      dist,
      "operate/b/index.html",
      `<html><body><a href="/email_assistant/operate/b/">Bravo</a><h1>Bravo</h1></body></html>`
    );
    expect(() => checkInPlacePages(dist, PAGES, root)).toThrow("in_place_page operate/b: sidebar");
    put(
      dist,
      "operate/b/index.html",
      `<html><body><a href="/email_assistant/operate/a/" aria-current="page">A</a><h1>Bravo</h1></body></html>`
    );
    expect(() => checkInPlacePages(dist, PAGES, root)).toThrow("in_place_page operate/b: sidebar");
  });
  test("a sidebar without the section Operate fails with section", () => {
    pass();
    put(dist, "operate/b/index.html", built("Bravo", "operate/b").replace(">Operate<", ">deploy<"));
    expect(() => checkInPlacePages(dist, PAGES, root)).toThrow("in_place_page operate/b: section");
  });
  test("a source without a heading fails with in_place_source", () => {
    pass();
    put(root, "docs/b.md", "no heading");
    expect(() => checkInPlacePages(dist, PAGES, root)).toThrow("in_place_source docs/b.md");
  });
});
