import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkLinks, pageLinks } from "./link-check";

const html = (body: string) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

describe("pageLinks", () => {
  test("reads href, src and id values of tags; ignores script text, data attributes and entities in attribute values", () => {
    const page = html(
      `<a href="/x/" id="a">x</a><img src='/i.png'><div data-src="/no" props="{&quot;href&quot;:1}" id=b></div>` +
        `<script>var s = '<a href="/script/" id="s">';</script><style>a[href="/style/"]{}</style><a name="n" href="/q?a=1&amp;b=2">q</a>`
    );
    expect(pageLinks(page)).toEqual({ links: ["/x/", "/i.png", "/q?a=1&b=2"], ids: new Set(["a", "b", "n"]) });
  });
});

describe("checkLinks", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "link-check-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };

  test.each<[string, Record<string, string>, number]>([
    [
      "T7 a link to a built page passes; the count is the number of pages",
      {
        "index.html": html(`<a href="/email_assistant/start/">s</a>`),
        "start/index.html": html(`<h1 id="_top">s</h1><a href="/email_assistant/">home</a>`),
      },
      2,
    ],
    [
      "attributes without a space between them are read",
      {
        "index.html": html(`<a href="/email_assistant/x/"id="a">x</a><a href="#a">y</a>`),
        "x/index.html": html(""),
      },
      2,
    ],
    [
      "an encoded path and an encoded anchor resolve",
      {
        "index.html": html(`<a href="/email_assistant/a%20b/#x%20y">1</a>`),
        "a b/index.html": html(`<h2 id="x y">x</h2>`),
      },
      2,
    ],
  ])("%s", (_name, pages, checked) => {
    for (const [path, text] of Object.entries(pages)) put(path, text);
    expect(checkLinks(dir)).toEqual({ checked });
  });
  test.each([
    [
      "T8 a link to a page that does not exist throws broken_link <href> in <page>",
      `<a href="/email_assistant/nope/">n</a>`,
      "broken_link /email_assistant/nope/ in index.html",
    ],
    [
      "a src is checked like an href",
      `<img src="/email_assistant/img/missing.png">`,
      "broken_link /email_assistant/img/missing.png in index.html",
    ],
    ["an absolute URL that does not parse is broken", `<a href="https://">x</a>`, "broken_link https:// in index.html"],
  ])("%s", (_name, body, message) => {
    put("index.html", html(body));
    expect(() => checkLinks(dir)).toThrow(message);
  });
  test("T9 an anchor that the page does not have throws; the same anchor on a path is checked on the target", () => {
    put("index.html", html(`<a href="#missing">m</a>`));
    expect(() => checkLinks(dir)).toThrow("broken_link #missing in index.html");
    put("index.html", html(`<a href="#here" id="here">h</a><a href="/email_assistant/start/#sec">s</a>`));
    put("start/index.html", html(`<h2 id="sec">s</h2>`));
    expect(checkLinks(dir)).toEqual({ checked: 2 });
    put("start/index.html", html(`<h2 id="other">s</h2>`));
    expect(() => checkLinks(dir)).toThrow("broken_link /email_assistant/start/#sec in index.html");
  });
  test("a file link resolves as <path>, <path>/index.html or <path>.html", () => {
    put(
      "index.html",
      html(
        `<a href="/email_assistant/a.txt">1</a><a href="/email_assistant/b">2</a><a href="/email_assistant/c">3</a><link href="/email_assistant/f.svg" rel="icon">`
      )
    );
    put("a.txt", "x");
    put("b/index.html", html(""));
    put("c.html", html(""));
    put("f.svg", "<svg/>");
    expect(checkLinks(dir)).toEqual({ checked: 3 });
    put("index.html", html(`<a href="/email_assistant/d">4</a>`));
    expect(() => checkLinks(dir)).toThrow("broken_link /email_assistant/d in index.html");
  });
  test("a page path with a trailing slash needs an index.html (a file of the same name does not count)", () => {
    put("index.html", html(`<a href="/email_assistant/a/">1</a>`));
    put("a.html", html(""));
    expect(() => checkLinks(dir)).toThrow("broken_link /email_assistant/a/ in index.html");
  });
  test("a folder with no index.html is not a page", () => {
    put("index.html", html(`<a href="/email_assistant/guide/">g</a>`));
    put("guide/step/index.html", html(""));
    expect(() => checkLinks(dir)).toThrow("broken_link /email_assistant/guide/ in index.html");
  });
  test("a relative link resolves against the page's own path", () => {
    put("index.html", html(`<a href="guide/">g</a>`));
    put("guide/index.html", html(`<a href="../">up</a><a href="step/">s</a><a href="../nope/">n</a>`));
    put("guide/step/index.html", html(""));
    expect(() => checkLinks(dir)).toThrow("broken_link ../nope/ in guide/index.html");
    put("guide/index.html", html(`<a href="../">up</a><a href="step/">s</a>`));
    expect(checkLinks(dir)).toEqual({ checked: 3 });
  });
  test("a path outside the base is broken; a base prefix that is only a prefix of a longer name is broken", () => {
    put("index.html", html(`<a href="/other/">o</a>`));
    expect(() => checkLinks(dir)).toThrow("broken_link /other/ in index.html");
    put("index.html", html(`<a href="/email_assistant2/">o</a>`));
    put("2/index.html", html(""));
    expect(() => checkLinks(dir)).toThrow("broken_link /email_assistant2/ in index.html");
  });
  test("links to other origins and non-http links are not fetched", () => {
    put(
      "index.html",
      html(
        `<a href="https://example.com/x">e</a><a href="//cdn.example.org/y">c</a><a href="mailto:a@x.test">m</a>` +
          `<link rel="canonical" href="https://artexs.github.io/email_assistant/404/"><a href="tel:1">t</a>`
      )
    );
    expect(checkLinks(dir)).toEqual({ checked: 1 });
  });
  test("#top and a bare # are valid on every page; an anchor on a non-html file is not checked", () => {
    put("index.html", html(`<a href="#">1</a><a href="#top">2</a><a href="/email_assistant/f.js#x">3</a>`));
    put("f.js", "x");
    expect(checkLinks(dir)).toEqual({ checked: 1 });
  });
  test("a build with no page throws", () => {
    expect(() => checkLinks(dir)).toThrow("no html page in the build");
  });
  test("another base works", () => {
    put("index.html", html(`<a href="/docs/x/">1</a>`));
    put("x/index.html", html(""));
    expect(checkLinks(dir, "/docs")).toEqual({ checked: 2 });
  });
});
