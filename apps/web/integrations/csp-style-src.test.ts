import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkDist, cspProblem, relaxStyleSrc } from "./csp-style-src";

const RELAXED = "style-src 'self' 'unsafe-inline';";

test("relaxStyleSrc replaces a style-src that ends with a semicolon", () => {
  const html = `<meta http-equiv="content-security-policy" content="script-src 'sha256-a'; style-src 'self' 'sha256-b'; img-src 'self'">`;
  expect(relaxStyleSrc(html)).toBe(
    `<meta http-equiv="content-security-policy" content="script-src 'sha256-a'; ${RELAXED} img-src 'self'">`
  );
});

test("relaxStyleSrc replaces a last style-src without the semicolon and keeps the closing quote", () => {
  const html = `<meta content="script-src 'self'; style-src 'self' 'sha256-b'"><p>x;</p>`;
  expect(relaxStyleSrc(html)).toBe(`<meta content="script-src 'self'; ${RELAXED}"><p>x;</p>`);
});

test("relaxStyleSrc leaves a page without style-src unchanged", () => {
  const html = `<meta content="script-src 'self'">`;
  expect(relaxStyleSrc(html)).toBe(html);
});

const GOOD = `<html><head><meta http-equiv="content-security-policy" content="default-src 'self';img-src 'self' data:;connect-src 'self';font-src 'self';form-action 'self';base-uri 'self';object-src 'none'; script-src 'self' 'sha256-a' 'sha256-b'; style-src 'self' 'unsafe-inline';"></head><body><p>x;</p></body></html>`;
const META = /<meta [^>]*>/;

describe("cspProblem", () => {
  test("T1 a good page has no problem", () => {
    expect(cspProblem(GOOD)).toBeNull();
  });
  test("T2 no meta", () => {
    expect(cspProblem(GOOD.replace(META, ""))).toBe("csp_meta_count");
  });
  test("T3 two metas", () => {
    expect(cspProblem(GOOD.replace(META, (m) => `${m}${m}`))).toBe("csp_meta_count");
  });
  test("T4 upper case attribute and value", () => {
    expect(
      cspProblem(GOOD.replace(`http-equiv="content-security-policy"`, `HTTP-EQUIV="Content-Security-Policy"`))
    ).toBeNull();
  });
  test("T5 no default-src 'self'", () => {
    expect(cspProblem(GOOD.replace("default-src 'self';", ""))).toBe("no_default_src");
  });
  test("T6 no script-src", () => {
    expect(cspProblem(GOOD.replace(" script-src 'self' 'sha256-a' 'sha256-b';", ""))).toBe("no_script_src");
  });
  test("T7 'unsafe-inline' in script-src", () => {
    expect(
      cspProblem(
        GOOD.replace("script-src 'self' 'sha256-a' 'sha256-b';", "script-src 'self' 'unsafe-inline' 'sha256-a';")
      )
    ).toBe("script_src_unsafe_inline");
  });
  test("T8 style-src not relaxed, or missing", () => {
    expect(cspProblem(GOOD.replace("style-src 'self' 'unsafe-inline';", "style-src 'self' 'sha256-c';"))).toBe(
      "style_src_not_relaxed"
    );
    expect(cspProblem(GOOD.replace(" style-src 'self' 'unsafe-inline';", ""))).toBe("style_src_not_relaxed");
  });
  test("T14 'unsafe-inline' in script-src-elem", () => {
    expect(cspProblem(GOOD.replace(`style-src`, `script-src-elem 'self' 'unsafe-inline'; style-src`))).toBe(
      "script_src_unsafe_inline"
    );
  });
  test("T15 'unsafe-inline' in script-src-attr", () => {
    expect(cspProblem(GOOD.replace(`style-src`, `script-src-attr 'unsafe-inline'; style-src`))).toBe(
      "script_src_unsafe_inline"
    );
  });
  test("T16 'unsafe-eval'", () => {
    expect(
      cspProblem(
        GOOD.replace("script-src 'self' 'sha256-a' 'sha256-b';", "script-src 'self' 'unsafe-eval' 'sha256-a';")
      )
    ).toBe("unsafe_eval");
  });
  test("T17 split style directive fails, a hashed script-src-elem passes", () => {
    expect(cspProblem(GOOD.replace(`style-src`, `style-src-elem 'self'; style-src`))).toBe("style_src_split");
    expect(cspProblem(GOOD.replace(`style-src`, `script-src-elem 'self' 'sha256-a'; style-src`))).toBeNull();
  });
});

describe("checkDist", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "csp-dist-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const HASHED = GOOD.replace("style-src 'self' 'unsafe-inline';", "style-src 'self' 'sha256-c';");

  test("T9 relaxes and checks every page, also in sub folders", () => {
    put("index.html", HASHED);
    put("legal/en/terms/index.html", HASHED);
    expect(checkDist(dir)).toEqual({ checked: 2, relaxed: 2 });
    expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(GOOD);
    expect(readFileSync(join(dir, "legal/en/terms/index.html"), "utf8")).toBe(GOOD);
  });
  test("T10 a page without the meta stops the build with its relative path", () => {
    put("index.html", GOOD);
    put("login/index.html", "<html><head></head><body></body></html>");
    expect(() => checkDist(dir)).toThrow(new Error("csp_meta_count in login/index.html"));
  });
  test("T11 'unsafe-inline' in script-src stops the build", () => {
    put("index.html", GOOD.replace("script-src 'self' 'sha256-a' 'sha256-b';", "script-src 'self' 'unsafe-inline';"));
    expect(() => checkDist(dir)).toThrow(new Error("script_src_unsafe_inline in index.html"));
  });
  test("T12 no page stops the build", () => {
    expect(() => checkDist(dir)).toThrow(new Error("no html page in the build"));
    put("_astro/x.js", "x");
    expect(() => checkDist(dir)).toThrow(new Error("no html page in the build"));
  });
  test("T13 an already relaxed page counts as checked, not relaxed", () => {
    put("index.html", GOOD);
    expect(checkDist(dir)).toEqual({ checked: 1, relaxed: 0 });
  });
});
