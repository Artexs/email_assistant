import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { docsCspProblem, scriptHashSource } from "@ea/core/web";

import { assertNoContentScript, contentScriptProblem, finalizeDist, finalizePage } from "./csp-finalize";

// What Astro writes for the docs config: its own hashes, a hashed style-src, no inline-script hashes.
const ASTRO_CSP =
  "default-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; script-src 'self' 'sha256-astro'; style-src 'self' 'sha256-style'";
const page = (body: string, csp = ASTRO_CSP) =>
  `<html><head><meta http-equiv="content-security-policy" content="${csp}"></head><body>${body}</body></html>`;
const TWO_SCRIPTS = page(
  `<script>a()</script><p>x;</p><script type="module">b(1)</script><script src="/x.js"></script>`
);

describe("finalizePage and finalizeDist", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "csp-finalize-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };

  test("T4 two unhashed inline scripts: both hashes land in script-src and the page passes docsCspProblem", () => {
    expect(docsCspProblem(TWO_SCRIPTS)).not.toBeNull();
    put("index.html", TWO_SCRIPTS);
    expect(finalizeDist(dir)).toEqual({ checked: 1, hashed: 2 });
    const html = readFileSync(join(dir, "index.html"), "utf8");
    expect(html).toContain(scriptHashSource("a()"));
    expect(html).toContain(scriptHashSource(`b(1)`));
    expect(html).toContain("script-src 'self' 'sha256-astro'");
    expect(html).toContain("style-src 'self' 'unsafe-inline';");
    expect(html).not.toContain("sha256-style");
    expect(docsCspProblem(html)).toBeNull();
  });
  test("a page that is final stays as it is; a second pass adds nothing", () => {
    const first = finalizePage(TWO_SCRIPTS).html;
    expect(finalizePage(first)).toEqual({ html: first, hashed: 0 });
  });
  test("a page without style-src gets the relaxed one; a script hash that is there is not added twice", () => {
    const hash = scriptHashSource("a()");
    const html = page(
      `<script>a()</script>`,
      ASTRO_CSP.replace("; style-src 'self' 'sha256-style'", "").replace("'sha256-astro'", hash)
    );
    const result = finalizePage(html);
    expect(result.hashed).toBe(0);
    expect(docsCspProblem(result.html)).toBeNull();
  });
  test("a $ in a script text does not change the meta rewrite", () => {
    const result = finalizePage(page(`<script>"$&$1"</script>`));
    expect(docsCspProblem(result.html)).toBeNull();
    expect(result.html).toContain(`<script>"$&$1"</script>`);
  });
  test("T5 no CSP meta stops the build with the path", () => {
    put("index.html", TWO_SCRIPTS);
    put("guide/index.html", "<html><head></head><body></body></html>");
    expect(() => finalizeDist(dir)).toThrow(new Error("csp_meta_count in guide/index.html"));
  });
  test("T5 'unsafe-inline' in script-src stops the build", () => {
    put("index.html", page("<p>x</p>", ASTRO_CSP.replace("script-src 'self'", "script-src 'unsafe-inline' 'self'")));
    expect(() => finalizeDist(dir)).toThrow(new Error("script_src_unsafe_inline in index.html"));
  });
  test("a page with a missing docs directive stops the build", () => {
    put("index.html", page("<p>x</p>", ASTRO_CSP.replace("form-action 'none'; ", "")));
    expect(() => finalizeDist(dir)).toThrow(new Error("docs_directive_missing form-action in index.html"));
  });
  test("a page with a script-src-elem without the hash stops the build", () => {
    put("index.html", page("<script>a()</script>", `${ASTRO_CSP}; script-src-elem 'self'`));
    expect(() => finalizeDist(dir)).toThrow(new Error("script_hash_missing in index.html"));
  });
  test("no page stops the build", () => {
    expect(() => finalizeDist(dir)).toThrow(new Error("no html page in the build"));
    put("_astro/x.js", "x");
    expect(() => finalizeDist(dir)).toThrow(new Error("no html page in the build"));
  });
});

describe("content scripts", () => {
  let root = "";
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "csp-content-"));
    mkdirSync(join(root, "src/content/docs/pl"), { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const content = () => join(root, "src/content/docs");

  test("T6 an .mdx with an onerror attribute fails with file and line", () => {
    writeFileSync(join(content(), "pl/start.mdx"), '# Start\n\n<img src="/a.png" onerror=x>\n');
    expect(() => assertNoContentScript(root, content())).toThrow(
      new Error("content_script src/content/docs/pl/start.mdx:3")
    );
  });
  test("a clean content folder passes, other file types are not read", () => {
    writeFileSync(join(content(), "index.mdx"), "# Home\n\nPress the button on the page; once done.\n");
    writeFileSync(join(content(), "note.txt"), "<script>x</script>");
    expect(() => assertNoContentScript(root, content())).not.toThrow();
  });
  test("an in-place source is checked too", () => {
    const outside = join(root, "README.md");
    writeFileSync(outside, "ok\n[x](javascript:alert(1))\n");
    expect(() => assertNoContentScript(root, content(), [outside])).toThrow(new Error("content_script README.md:2"));
  });
  test.each([
    ["<script>x</script>", true],
    ["<SCRIPT src=x>", true],
    ["[a](JavaScript:x)", true],
    ['<a onclick="x">', true],
    ["<img\tonerror=x>", true],
    ["<p onLoad = x>", true],
    ["an online = value", true], // conservative: prose that looks like an attribute fails too
    ["a description of onboarding", false],
    ["on=x", false],
  ])("contentScriptProblem(%j) is %p", (text, bad) => {
    expect(contentScriptProblem(text, "f.md") !== null).toBe(bad);
  });
});
