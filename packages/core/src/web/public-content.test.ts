import { describe, expect, test } from "bun:test";

import { DOCS_ORIGIN } from "../site";

import { parseAllowList, publicContentProblems, publicContentScan } from "./public-content";

const rules = (text: string, allow: readonly string[] = []) => publicContentProblems(text, allow).map((p) => p.rule);

describe("R1 tailnet host", () => {
  test("T8 a real host fails, the placeholder passes, a host split by tags fails", () => {
    expect(publicContentProblems("bob.tail1234.ts.net", [])).toEqual([{ rule: "R1", match: "bob.tail1234.ts.net" }]);
    expect(rules("<machine>.<tailnet>.ts.net")).toEqual([]);
    expect(rules("&lt;machine&gt;.&lt;tailnet&gt;.ts.net:9443")).toEqual([]);
    expect(rules("<code>&lt;machine&gt;.&lt;tailnet&gt;<span>.ts.net</span></code>")).toEqual([]);
    expect(publicContentProblems("bob.<span>tail1234</span>.ts.net", [])).toEqual([
      { rule: "R1", match: "bob.tail1234.ts.net" },
    ]);
  });
  test("a placeholder with a real label, an upper case host and a sub host fail; a longer domain passes", () => {
    expect(rules("<machine>.tail1234.ts.net")).toEqual(["R1"]);
    expect(rules("BOB.TAIL1234.TS.NET")).toEqual(["R1"]);
    expect(rules("a.b.c.ts.net.")).toEqual(["R1"]);
    expect(rules("host.ts.network")).toEqual([]);
  });
});

describe("R2 mail address", () => {
  test("T9 a real domain fails; example and reserved domains pass", () => {
    expect(publicContentProblems("ann@firma.pl", [])).toEqual([{ rule: "R2", match: "ann@firma.pl" }]);
    expect(
      rules("ann@x.test, ops@example.com, a@b.example, a@b.invalid, a@host.localhost, a@mail.example.org")
    ).toEqual([]);
    expect(rules("Ann@Example.NET")).toEqual([]);
  });
  test("T9 an allow entry lets its address pass, and only that address", () => {
    expect(rules("a@b.com", ["a@b.com"])).toEqual([]);
    expect(rules("a@b.com.pl", ["a@b.com"])).toEqual(["R2"]);
  });
  test("a trailing dot, a package version and an image name are not addresses", () => {
    expect(rules("write to ann@x.test.")).toEqual([]);
    expect(rules("pkg@1.2.3 logo@2x.png")).toEqual([]);
    expect(rules("p@x.test.vcf")).toEqual(["R2"]);
  });
});

describe("R3 IPv4", () => {
  test("T10 a 100.64/10 or public address fails", () => {
    expect(publicContentProblems("100.101.102.103 and 8.8.8.8", [])).toEqual([
      { rule: "R3", match: "100.101.102.103" },
      { rule: "R3", match: "8.8.8.8" },
    ]);
    expect(rules("100.64.0.1 100.127.255.255")).toEqual(["R3", "R3"]);
  });
  test("T10 RFC 1918, loopback, 0.0.0.0 and the documentation nets pass", () => {
    expect(
      rules("172.30.0.1 127.0.0.1 0.0.0.0 10.1.2.3 192.168.1.1 172.16.0.1 192.0.2.7 198.51.100.7 203.0.113.7")
    ).toEqual([]);
  });
  test("edges: 172.32 and 100.128 are public; a version, an octet over 255 and a dotted tail are not addresses", () => {
    expect(rules("172.32.0.1 100.128.0.1")).toEqual(["R3", "R3"]);
    expect(rules("v1.2.3.4.5 300.1.1.1 x1.2.3.4")).toEqual([]);
  });
  test("an allow entry lets 100.100.100.100 pass", () => {
    expect(rules("100.100.100.100", ["100.100.100.100"])).toEqual([]);
  });
});

describe("R4 external asset", () => {
  test("T11 an external src fails, a link to another site passes", () => {
    expect(publicContentProblems(`<img src="https://cdn.example.org/a.png">`, [])).toEqual([
      { rule: "R4", match: "https://cdn.example.org/a.png" },
    ]);
    expect(rules(`<a href="https://github.com/">x</a>`)).toEqual([]);
  });
  test("a same-site, relative or data source passes", () => {
    expect(rules(`<img src="/email_assistant/a.png"><img src='a.png'><img src="data:image/png;base64,AA==">`)).toEqual(
      []
    );
    expect(rules(`<img src="${DOCS_ORIGIN}/email_assistant/a.png">`)).toEqual([]);
  });
  test("srcset, a protocol-relative source, an unquoted source and a script src fail", () => {
    expect(rules(`<img srcset="/a.png 1x, https://cdn.test/b.png 2x">`)).toEqual(["R4"]);
    expect(rules(`<img src=//cdn.test/a.png>`)).toEqual(["R4"]);
    expect(rules(`<script src="http://x.test/a.js"></script>`)).toEqual(["R4"]);
  });
  test("link rel stylesheet, preload, modulepreload and icon to another origin fail; canonical and alternate pass", () => {
    for (const rel of ["stylesheet", "preload", "modulepreload", "icon", "shortcut icon"]) {
      expect(rules(`<link rel="${rel}" href="https://fonts.test/a">`)).toEqual(["R4"]);
    }
    expect(rules(`<link href="https://fonts.test/a" rel=stylesheet>`)).toEqual(["R4"]);
    expect(
      rules(`<link rel="canonical" href="https://other.test/"><link rel="alternate" href="https://other.test/pl/">`)
    ).toEqual([]);
    expect(rules(`<link rel="stylesheet" href="/_astro/a.css">`)).toEqual([]);
  });
  test("a CSS url( to another origin fails, a local or data url passes", () => {
    expect(rules(`a{background:url("https://x.test/a.png")}`)).toEqual(["R4"]);
    expect(rules(`@font-face{src:url(https://x.test/a.woff2)}`)).toContain("R4");
    expect(rules(`a{background:url(/a.png)} b{background:url(data:image/svg+xml,%3Csvg%3E)}`)).toEqual([]);
  });
});

describe("R5 to R7", () => {
  test("T11 a form fails", () => {
    expect(publicContentProblems(`<form action="/x">`, [])).toEqual([{ rule: "R5", match: "<form" }]);
    expect(rules(`&lt;form&gt; and <formal>`)).toEqual([]);
  });
  test.each(["document.cookie", "gtag(", "googletagmanager", "plausible", "umami", "posthog", "segment.com"])(
    "R6 %s",
    (token) => {
      expect(rules(`x ${token} y`)).toEqual(["R6"]);
    }
  );
  test.each(["Inbox Zero", "Fyxer", "Superhuman", "Shortwave", "SaneBox"])("R7 %s", (name) => {
    expect(rules(`about ${name}.`)).toEqual(["R7"]);
  });
  test("T11 fyxer in lower case fails with R7", () => {
    expect(publicContentProblems("fyxer", [])).toEqual([{ rule: "R7", match: "fyxer" }]);
  });
  test("a name split by tags fails on the text without tags", () => {
    expect(rules("<b>Fy</b>xer")).toEqual(["R7"]);
  });
});

describe("allow list", () => {
  test("T12 the scan names the used entries; an unused one is the caller's to report", () => {
    const scan = publicContentScan("a@b.com", ["a@b.com", "100.100.100.100"]);
    expect(scan).toEqual({ problems: [], used: ["a@b.com"] });
  });
  test("a problem is reported once, also when the raw and the stripped text both match", () => {
    expect(rules("<p>8.8.8.8</p> <p>8.8.8.8</p>")).toEqual(["R3"]);
  });
  test("parseAllowList reads entry and reason, skips blank and comment lines, and rejects a line without a reason", () => {
    expect(parseAllowList("# note\n\na@b.com | doc example\n100.100.100.100 | Tailscale DNS\n")).toEqual([
      "a@b.com",
      "100.100.100.100",
    ]);
    expect(() => parseAllowList("a@b.com\n")).toThrow("allow_entry_invalid line 1");
    expect(() => parseAllowList("ok | reason\nx | \n")).toThrow("allow_entry_invalid line 2");
    expect(() => parseAllowList(" | reason\n")).toThrow("allow_entry_invalid line 1");
  });
});

describe("IPv4 address classes", () => {
  test("172.31.255.1 is a private address and passes", () => {
    expect(publicContentProblems("ip 172.31.255.1 x", [])).toEqual([]);
  });
  test.each([
    "172.15.0.1",
    "172.32.0.1",
    "192.169.1.1",
    "0.0.0.1",
    "192.0.3.1",
    "198.51.101.7",
    "203.0.114.9",
    "8.8.8.8",
    "8.20.0.1",
    "8.168.0.1",
    "8.0.2.1",
    "192.1.2.1",
    "192.51.100.1",
    "8.51.100.1",
    "198.52.100.1",
    "8.0.113.1",
    "203.1.113.1",
    "192.0.113.1",
  ])("%s is a public address and fails", (address) => {
    expect(publicContentProblems(`ip ${address} x`, [])).toEqual([{ rule: "R3", match: address }]);
  });
});

describe("external asset forms", () => {
  test.each([
    [`<img src='//cdn.x.io/a.png'>`, "//cdn.x.io/a.png"],
    [`<img src=" https://cdn.x.io/a.png ">`, " https://cdn.x.io/a.png "],
    [`<img SRCSET='//cdn.x.io/a.png 2x'>`, "//cdn.x.io/a.png"],
    [`<link REL="stylesheet" HREF="https://cdn.x.io/s.css">`, "https://cdn.x.io/s.css"],
    [`a{background:url('https://cdn.x.io/i.png')}`, "https://cdn.x.io/i.png"],
    [`a{background:url( 'https://cdn.x.io/i.png' )}`, "https://cdn.x.io/i.png"],
    [`<p style="background:url('https://cdn.x.io/i.png')">`, "https://cdn.x.io/i.png"],
  ])("%s fails with its url", (html, url) => {
    expect(publicContentProblems(html, [])).toEqual([{ rule: "R4", match: url }]);
  });
  test.each([`<img src="${DOCS_ORIGIN}/a.png">`, `<img src="${DOCS_ORIGIN}">`, `<img src="/https://cdn.x.io/a.png">`])(
    "%s passes",
    (html) => {
      expect(publicContentProblems(html, [])).toEqual([]);
    }
  );
});

describe("parseAllowList lines", () => {
  test("it skips an indented comment line and a line of spaces", () => {
    expect(parseAllowList("   # indented\n   \nok | fine\n")).toEqual(["ok"]);
  });
  test("it trims the spaces around the entry and the reason", () => {
    expect(parseAllowList("  1.2.3.4  |  demo  ")).toEqual(["1.2.3.4"]);
  });
  test.each([
    ["no separator", "a\n", "allow_entry_invalid line 1"],
    ["a bar without spaces", "a|b\n", "allow_entry_invalid line 1"],
    ["an empty entry", "# c\n | reason\n", "allow_entry_invalid line 2"],
    ["an empty reason", "ok | fine\n\nx | \n", "allow_entry_invalid line 3"],
  ])("%s throws with the line number", (_name, text, message) => {
    expect(() => parseAllowList(text)).toThrow(new Error(message));
  });
});
