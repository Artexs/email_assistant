import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { cspProblem, docsCspProblem, inlineScripts, parseDirectives, scriptHashSource } from "./csp";
import { sha256Base64 } from "./sha256";

const GOOD = `<html><head><meta http-equiv="content-security-policy" content="default-src 'self';img-src 'self' data:;connect-src 'self';font-src 'self';form-action 'self';base-uri 'self';object-src 'none'; script-src 'self' 'sha256-a' 'sha256-b'; style-src 'self' 'unsafe-inline';"></head><body><p>x;</p></body></html>`;
const DOCS_GOOD = GOOD.replace("form-action 'self'", "form-action 'none'");
const META = /<meta [^>]*>/;

// The cases of the panel's `csp-style-src.test.ts` (moved with the function).
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

describe("script_hash_missing", () => {
  const withScript = (script: string, scriptSrc = "script-src 'self'") =>
    GOOD.replace("script-src 'self' 'sha256-a' 'sha256-b'", scriptSrc).replace("<p>", `${script}<p>`);

  test("hash T2 an unhashed inline script fails, the hash of its exact text passes, a script with src needs none", () => {
    expect(cspProblem(withScript("<script>a()</script>"))).toBe("script_hash_missing");
    expect(cspProblem(withScript("<script>a()</script>", `script-src 'self' ${scriptHashSource("a()")}`))).toBeNull();
    expect(cspProblem(withScript(`<script src="/x.js"></script>`))).toBeNull();
    expect(cspProblem(withScript(`<script type="module" data-x=">" src='/x.js'></script>`))).toBeNull();
  });
  test("a hash of other text, a changed space and a data-src attribute still fail", () => {
    const hashed = `script-src 'self' ${scriptHashSource("a()")}`;
    expect(cspProblem(withScript("<script>b()</script>", hashed))).toBe("script_hash_missing");
    expect(cspProblem(withScript("<script> a()</script>", hashed))).toBe("script_hash_missing");
    expect(cspProblem(withScript(`<script data-src="/x.js">a()</script>`))).toBe("script_hash_missing");
  });
  test("script-src-elem governs script elements when it exists", () => {
    const html = withScript(
      "<script>a()</script>",
      `script-src 'self' ${scriptHashSource("a()")}; script-src-elem 'self'`
    );
    expect(cspProblem(html)).toBe("script_hash_missing");
  });
  test("every inline script is checked, in page order", () => {
    expect(inlineScripts(`<script>a</script><script src="/x.js"></script><SCRIPT type="module">b</SCRIPT >`)).toEqual([
      "a",
      "b",
    ]);
    const hashed = `script-src 'self' ${scriptHashSource("a")}`;
    expect(cspProblem(withScript("<script>a</script><script>b</script>", hashed))).toBe("script_hash_missing");
  });
});

describe("docsCspProblem", () => {
  test("docs T3 a good docs page has no problem", () => {
    expect(docsCspProblem(DOCS_GOOD)).toBeNull();
  });
  test("docs T3 a docs page without form-action 'none' fails", () => {
    expect(docsCspProblem(GOOD)).toBe("docs_directive_missing form-action");
    expect(docsCspProblem(DOCS_GOOD.replace("form-action 'none';", ""))).toBe("docs_directive_missing form-action");
  });
  test.each([
    ["object-src 'none';", "object-src"],
    ["base-uri 'self';", "base-uri"],
    ["connect-src 'self';", "connect-src"],
  ])("a docs page without %s fails", (directive, name) => {
    expect(docsCspProblem(DOCS_GOOD.replace(directive, ""))).toBe(`docs_directive_missing ${name}`);
  });
  test("a directive with another value fails", () => {
    expect(docsCspProblem(DOCS_GOOD.replace("object-src 'none'", "object-src 'self'"))).toBe(
      "docs_directive_missing object-src"
    );
  });
  test("a problem of cspProblem comes first", () => {
    expect(docsCspProblem(DOCS_GOOD.replace(META, ""))).toBe("csp_meta_count");
    expect(docsCspProblem(DOCS_GOOD.replace("<p>", "<script>a()</script><p>"))).toBe("script_hash_missing");
  });
});

describe("sha256Base64", () => {
  test.each(["", "a()", "é ☃ 𝒳", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(1000)])(
    "matches node:crypto for %#",
    (text) => {
      expect(sha256Base64(text)).toBe(createHash("sha256").update(text).digest("base64"));
    }
  );
});

describe("parseDirectives", () => {
  test("it drops spaces and empty parts between semicolons and keeps the inner spaces of a directive", () => {
    expect(parseDirectives(" default-src 'self' ;; ;  img-src  data: ;")).toEqual([
      { text: "default-src 'self'", name: "default-src" },
      { text: "img-src  data:", name: "img-src" },
    ]);
  });
  test("it keeps the case of a directive name", () => {
    expect(parseDirectives("Default-SRC 'self'")).toEqual([{ text: "Default-SRC 'self'", name: "Default-SRC" }]);
  });
  test("it splits a directive name from its sources on any run of white space", () => {
    expect(parseDirectives("script-src\t'self'\n'none'")).toEqual([
      { text: "script-src\t'self'\n'none'", name: "script-src" },
    ]);
  });
  test("an empty policy has no directive", () => {
    expect(parseDirectives("")).toEqual([]);
    expect(parseDirectives(" ; ;")).toEqual([]);
  });
});
