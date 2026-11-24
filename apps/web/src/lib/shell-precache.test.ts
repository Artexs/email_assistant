import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { offlineAssets, readShell, shellVersion } from "./shell-precache";

const PAGE = `<html><head><link rel="stylesheet" href="/_astro/a.css"></head><body></body></html>`;
const FONT_CSS = `@font-face{src:url(/_astro/n.woff2) format("woff2")}`;
const bytes = (text: string) => new TextEncoder().encode(text);

describe("offlineAssets", () => {
  test("lists the linked style sheet and the font files of its url() calls, sorted", () => {
    expect(offlineAssets(PAGE, { "/_astro/a.css": FONT_CSS })).toEqual(["/_astro/a.css", "/_astro/n.woff2"]);
  });

  test("leaves out http and data addresses and a duplicate", () => {
    const css = [
      `@font-face{src:url("/_astro/z.woff2")}`,
      `a{background:url(http://other.example/x.png)}`,
      `b{background:url('data:image/png;base64,AAAA')}`,
      `c{background:url( /_astro/z.woff2 )}`,
      `d{background:url(/_astro/b.woff2?v=1)}`,
    ].join("\n");
    expect(offlineAssets(PAGE, { "/_astro/a.css": css })).toEqual([
      "/_astro/a.css",
      "/_astro/b.woff2",
      "/_astro/z.woff2",
    ]);
  });

  test("a link with the address before the rel and a file outside /_astro/ are read the same way", () => {
    const html = `<link href='/_astro/b.css' rel="stylesheet"><link rel="icon" href="/icons/icon-192.png">`;
    expect(offlineAssets(html, {})).toEqual(["/_astro/b.css"]);
  });
});

describe("shellVersion", () => {
  const files = [
    { path: "/offline.html", bytes: bytes("page") },
    { path: "/_astro/a.css", bytes: bytes("css") },
  ];

  test("has the format v2- and 8 hex characters, and does not depend on the order", () => {
    expect(shellVersion(files)).toMatch(/^v2-[0-9a-f]{8}$/);
    expect(shellVersion([...files].reverse())).toBe(shellVersion(files));
  });

  test("changes when only the bytes of the offline page change", () => {
    const changed = [{ path: "/offline.html", bytes: bytes("page 2") }, files[1] as (typeof files)[number]];
    expect(shellVersion(changed)).not.toBe(shellVersion(files));
  });
});

describe("readShell", () => {
  function withDist(build: (dist: string) => void, check: (dist: string) => void): void {
    const dist = mkdtempSync(join(tmpdir(), "ea-shell-"));
    try {
      mkdirSync(join(dist, "_astro"));
      build(dist);
      check(dist);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  }

  test("reads the page, its style sheet and its font, and gives the list and the version", () => {
    withDist(
      (dist) => {
        writeFileSync(join(dist, "offline.html"), PAGE);
        writeFileSync(join(dist, "_astro/a.css"), FONT_CSS);
        writeFileSync(join(dist, "_astro/n.woff2"), "font");
      },
      (dist) => {
        const shell = readShell(dist);
        expect(shell.assets).toEqual(["/_astro/a.css", "/_astro/n.woff2"]);
        expect(shell.version).toMatch(/^v2-[0-9a-f]{8}$/);
      }
    );
  });

  test("reads the page when Astro wrote it as a folder with an index file", () => {
    withDist(
      (dist) => {
        mkdirSync(join(dist, "offline.html"));
        writeFileSync(join(dist, "offline.html/index.html"), PAGE);
        writeFileSync(join(dist, "_astro/a.css"), "body{}");
      },
      (dist) => expect(readShell(dist).assets).toEqual(["/_astro/a.css"])
    );
  });

  test("refuses a page with no style sheet", () => {
    withDist(
      (dist) => writeFileSync(join(dist, "offline.html"), "<html><body>no css</body></html>"),
      (dist) => expect(() => readShell(dist)).toThrow("/offline.html links no style sheet")
    );
  });

  test("refuses a listed file that is missing in dist", () => {
    withDist(
      (dist) => {
        writeFileSync(join(dist, "offline.html"), PAGE);
        writeFileSync(join(dist, "_astro/a.css"), FONT_CSS);
      },
      (dist) => expect(() => readShell(dist)).toThrow("listed file /_astro/n.woff2 is missing")
    );
  });
});
