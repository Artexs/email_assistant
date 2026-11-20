import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { parseAllowList } from "@ea/core/web";

import { checkPublicContent } from "./public-content";

describe("checkPublicContent", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "public-content-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };

  test("a clean site passes and counts its text files, not other files", () => {
    put("index.html", "<p>ops@example.com</p>");
    put("_astro/a.css", "a{color:red}");
    put("sitemap.xml", "<urlset/>");
    put("logo.png", "bob.tail1234.ts.net");
    expect(checkPublicContent(dir, [])).toEqual({ checked: 3 });
  });
  test("a problem stops the build with rule, relative file and match", () => {
    put("index.html", "<p>x</p>");
    put("guide/setup/index.html", "<p>host bob.tail1234.ts.net</p>");
    expect(() => checkPublicContent(dir, [])).toThrow(
      new Error("public_content R1 in guide/setup/index.html: bob.tail1234.ts.net")
    );
  });
  test.each([
    ["x.json", `{"k":"ann@firma.pl"}`, "R2"],
    ["_astro/a.js", `fetch("x");var u="100.101.102.103"`, "R3"],
    ["_astro/a.css", `a{background:url(https://x.test/a.png)}`, "R4"],
    ["icon.svg", `<svg><image href="x"/><script>document.cookie</script></svg>`, "R6"],
    ["site.webmanifest", `{"name":"Superhuman"}`, "R7"],
    ["robots.txt", `<form action="/x">`, "R5"],
    ["demo/demo.en.vtt", "WEBVTT\n\n00:00.000 --> 00:01.000\nWrite to jan@firma.pl", "R2"],
  ])("T12 %s is checked", (file, text, rule) => {
    put("index.html", "<p>x</p>");
    put(file, text);
    expect(() => checkPublicContent(dir, [])).toThrow(`public_content ${rule} in ${file}`);
  });
  test("the pagefind folder at the top is not checked, a folder of that name deeper is", () => {
    put("index.html", "<p>x</p>");
    put("pagefind/pagefind.js", "ann@firma.pl");
    expect(checkPublicContent(dir, [])).toEqual({ checked: 1 });
    put("docs/pagefind/a.html", "ann@firma.pl");
    expect(() => checkPublicContent(dir, [])).toThrow("public_content R2 in docs/pagefind/a.html");
  });
  test("an allow entry lets a string pass in any file", () => {
    put("index.html", "<p>a@b.com</p>");
    put("x/index.html", "<p>a@b.com</p>");
    expect(checkPublicContent(dir, ["a@b.com"])).toEqual({ checked: 2 });
  });
  test("T12 an allow entry that no file needs fails the build", () => {
    put("index.html", "<p>a@b.com</p>");
    expect(() => checkPublicContent(dir, ["a@b.com", "100.100.100.100"])).toThrow(
      new Error("unused_allow 100.100.100.100")
    );
  });
  test("a build with no text file fails", () => {
    put("logo.png", "x");
    expect(() => checkPublicContent(dir, [])).toThrow(new Error("no public file in the build"));
  });
});

describe("public-content-allow.txt", () => {
  test("every line has an entry and a reason", () => {
    const allow = parseAllowList(readFileSync(join(import.meta.dir, "../public-content-allow.txt"), "utf8"));
    expect(allow.length).toBeGreaterThan(0);
    expect(new Set(allow).size).toBe(allow.length);
  });
});
