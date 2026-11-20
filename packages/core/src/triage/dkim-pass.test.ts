import { describe, expect, test } from "bun:test";

import { hasCoveredDkimPass } from "./dkim-pass";
import type { DkimSignature } from "./dkim-signature";

const TRUSTED = ["interia.pl"];

// The shared hosting suffixes of the alignment cases below (same list as the suffix case).
const SHARED_SUFFIXES = [
  "github.io",
  "pages.dev",
  "vercel.app",
  "netlify.app",
  "blogspot.com",
  "herokuapp.com",
  "azurewebsites.net",
  "web.app",
  "firebaseapp.com",
  "onrender.com",
];

// One covering signature (`h=` names From and both list headers) per `header.d` domain that a case of this file uses.
// Built from a fixed list and the suffix array, not from the case strings: a case with a new domain must add it here.
const SIGNED_DOMAINS = [
  "c.example",
  "news.c.example",
  "a.news.c.example",
  "other.c.example",
  "example",
  "co.uk",
  "evilc.example",
  "other.example",
  "x.example",
  "evil.example",
  ...SHARED_SUFFIXES.flatMap((suffix) => [suffix, `other.${suffix}`, `evil.${suffix}`]),
];
const SIGNED: DkimSignature[] = SIGNED_DOMAINS.map((d) => ({
  d,
  h: ["from", "list-unsubscribe", "list-unsubscribe-post"],
}));

// Fails when the input names a `header.d` (also inside a comment or a quoted string) that has no signature in SIGNED:
// otherwise a false case could be false only for the missing signature, whatever the parser does.
function expectSigned(authResults: string | null): void {
  const signed = new Set(SIGNED.map((signature) => signature.d));
  for (const match of (authResults ?? "").matchAll(/header\.d\s*=\s*([^\s;)"]+)/gi)) {
    const domain = (match[1] ?? "").toLowerCase().replace(/\.+$/, "");
    if (!signed.has(domain)) throw new Error(`unsigned header.d ${domain}: add it to SIGNED`);
  }
}

// The cases of the removed weaker check: a pass that SIGNED covers, so the result decides only on the parser and the alignment.
function alignedCovered(
  authResults: string | null,
  trustedAuthservIds: readonly string[],
  fromDomain: string
): boolean {
  expectSigned(authResults);
  return hasCoveredDkimPass(authResults, trustedAuthservIds, fromDomain, SIGNED);
}

describe("the Authentication-Results parser and the alignment of the trusted result, through hasCoveredDkimPass", () => {
  test("1: a trusted id, dkim=pass and header.d of the From domain", () => {
    expect(alignedCovered("interia.pl; dkim=pass header.d=c.example", TRUSTED, "c.example")).toBe(true);
    expect(alignedCovered("mx.interia.pl; spf=pass; dkim=pass header.d=c.example", TRUSTED, "c.example")).toBe(true);
  });

  test("2: header.d of a parent of the From domain counts, down to the registrable domain only", () => {
    const pass = (d: string) => `interia.pl; dkim=pass header.d=${d}`;
    expect(alignedCovered(pass("c.example"), TRUSTED, "news.c.example")).toBe(true);
    expect(alignedCovered(pass("news.c.example"), TRUSTED, "a.news.c.example")).toBe(true);
    // A child, a sibling and a public suffix do not count.
    expect(alignedCovered(pass("news.c.example"), TRUSTED, "c.example")).toBe(false);
    expect(alignedCovered(pass("other.c.example"), TRUSTED, "news.c.example")).toBe(false);
    expect(alignedCovered(pass("example"), TRUSTED, "c.example")).toBe(false);
    expect(alignedCovered(pass("co.uk"), TRUSTED, "shop.co.uk")).toBe(false);
    expect(alignedCovered(pass("evilc.example"), TRUSTED, "c.example")).toBe(false);
  });

  test("3: an authserv-id that is not trusted gives false, even with dkim=pass for the right domain", () => {
    expect(alignedCovered("evil.example; dkim=pass header.d=c.example", TRUSTED, "c.example")).toBe(false);
    expect(alignedCovered("notinteria.pl; dkim=pass header.d=c.example", TRUSTED, "c.example")).toBe(false);
    expect(alignedCovered("interia.pl; dkim=pass header.d=c.example", [], "c.example")).toBe(false);
  });

  test("4: dkim=fail, none, a missing header.d, another domain, and a pass in a comment give false", () => {
    const check = (value: string | null) => alignedCovered(value, TRUSTED, "c.example");
    expect(check("interia.pl; dkim=fail header.d=c.example")).toBe(false);
    expect(check("interia.pl; dkim=none")).toBe(false);
    expect(check("interia.pl; dkim=pass")).toBe(false);
    expect(check("interia.pl; dkim=pass header.d=other.example")).toBe(false);
    expect(check("interia.pl; dkim=fail (dkim=pass header.d=c.example) header.d=c.example")).toBe(false);
    // The comment holds a signing domain that matches: it is not part of the result.
    expect(check("interia.pl; dkim=pass (checked header.d=c.example) header.d=other.example")).toBe(false);
    expect(check("interia.pl; dkim=pass (checked header.d=other.example) header.d=c.example")).toBe(true);
    expect(check("interia.pl; spf=pass smtp.mailfrom=c.example; dkim=fail header.d=c.example")).toBe(false);
    expect(check("interia.pl; x-dkim=pass header.d=c.example")).toBe(false);
    expect(check("interia.pl")).toBe(false);
    expect(check(null)).toBe(false);
    expect(alignedCovered("interia.pl; dkim=pass header.d=c.example", TRUSTED, "")).toBe(false);
  });

  test("5: case and a second result: the passing result may follow a failing one", () => {
    expect(
      alignedCovered("Interia.PL; DKIM=Pass Header.D=C.Example; dkim=fail header.d=x.example", TRUSTED, "c.example")
    ).toBe(true);
    expect(
      alignedCovered("interia.pl; dkim=fail header.d=c.example; dkim=pass header.d=c.example", TRUSTED, "c.example")
    ).toBe(true);
  });

  // The header is lexed per RFC 8601 before it is split on `;`.
  test("6: a `;` or a `dkim=pass` inside a comment or a quoted string never makes a result", () => {
    const check = (value: string) => alignedCovered(value, TRUSTED, "c.example");
    // The three probes of the review.
    expect(
      check(
        'interia.pl; spf=pass smtp.mailfrom="x;dkim=pass header.d=c.example x"@evil.example; dkim=pass header.d=evil.example'
      )
    ).toBe(false);
    expect(check("interia.pl; dkim=fail (bad; dkim=pass header.d=c.example ) header.d=c.example")).toBe(false);
    expect(check('interia.pl; dkim=fail reason="x; dkim=pass header.d=c.example y"')).toBe(false);
    // Nested comments, an escaped parenthesis, a folded comment and an escaped quote.
    expect(check("interia.pl; dkim=fail (a (b; dkim=pass header.d=c.example) c; d) header.d=x.example")).toBe(false);
    expect(check("interia.pl; dkim=fail (a \\) ; dkim=pass header.d=c.example) header.d=x.example")).toBe(false);
    expect(check("interia.pl; dkim=fail (a\r\n ; dkim=pass\r\n header.d=c.example)")).toBe(false);
    expect(check('interia.pl; dkim=fail reason="a \\" ; dkim=pass header.d=c.example"')).toBe(false);
    // An escaped parenthesis or quote does not end its comment or string: without the escape these would read as a result.
    expect(check("interia.pl; dkim=fail (a \\) ; dkim=pass header.d=c.example ( )")).toBe(false);
    expect(check('interia.pl; dkim=fail reason="a \\" ; dkim=pass header.d=c.example "x"')).toBe(false);
    // The real result is still read when comments and quoted strings surround it.
    expect(
      check('interia.pl (mx 1; ok); spf=pass smtp.mailfrom="a;b"@x.example; dkim=pass (good) header.d=c.example')
    ).toBe(true);
    expect(check("interia.pl;\r\n dkim=pass\r\n header.d=c.example")).toBe(true);
    expect(check("interia.pl; dkim=pass header.d=c.example (a (b) c)")).toBe(true);
    // Only the ASCII `;` and `(` count: a full-width one is text, even though NFKC would turn it into the ASCII one.
    expect(check("interia.pl; dkim=fail \uff1b dkim=pass header.d=c.example")).toBe(false);
    expect(check("interia.pl; dkim=fail \uff08 dkim=pass header.d=c.example \uff09; dkim=fail")).toBe(false);
  });

  test("7: a malformed value (open comment, open quote, stray parenthesis) trusts nothing; a NUL after pass is no pass", () => {
    const check = (value: string) => alignedCovered(value, TRUSTED, "c.example");
    expect(check("interia.pl; dkim=pass header.d=c.example (open")).toBe(false);
    expect(check('interia.pl; dkim=pass header.d=c.example; x="open')).toBe(false);
    expect(check("interia.pl; dkim=pass header.d=c.example)")).toBe(false);
    expect(check("interia.pl; dkim=pass\u0000 header.d=c.example")).toBe(false);
  });

  test("8: a shared hosting suffix is not a registrable domain: one more label is needed (NOTE 3)", () => {
    for (const suffix of SHARED_SUFFIXES) {
      const pass = (d: string) => `interia.pl; dkim=pass header.d=${d}`;
      // A signature of the suffix does not align with a tenant, and a tenant does not align with a sibling.
      expect({ suffix, ok: alignedCovered(pass(suffix), TRUSTED, `evil.${suffix}`) }).toEqual({
        suffix,
        ok: false,
      });
      expect(alignedCovered(pass(`other.${suffix}`), TRUSTED, `evil.${suffix}`)).toBe(false);
      // The tenant domain and its parents down to the tenant label still align.
      expect(alignedCovered(pass(`evil.${suffix}`), TRUSTED, `evil.${suffix}`)).toBe(true);
      expect(alignedCovered(pass(`evil.${suffix}`), TRUSTED, `news.evil.${suffix}`)).toBe(true);
    }
    // A domain that is not a shared suffix keeps the old rule.
    expect(alignedCovered("interia.pl; dkim=pass header.d=c.example", TRUSTED, "news.c.example")).toBe(true);
  });
});

describe("the lexing of the Authentication-Results value and the alignment, edge cases", () => {
  test.each([
    {
      name: "a comment between pass and header.d counts as a space",
      value: "interia.pl; dkim=pass(ok)header.d=c.example",
      expected: true,
    },
    {
      name: "an escaped ( does not open a nested comment",
      value: "interia.pl (a \\( b); dkim=pass header.d=c.example",
      expected: true,
    },
    {
      name: "a quote inside a comment is text",
      value: 'interia.pl; dkim=pass header.d=c.example (a " b)',
      expected: true,
    },
    {
      name: "a ( inside a quoted string is text",
      value: 'interia.pl; dkim=pass header.d=c.example; x="a(b"',
      expected: true,
    },
    {
      name: "a ) inside a quoted string is text",
      value: 'interia.pl; dkim=pass header.d=c.example; x="a)b"',
      expected: true,
    },
    {
      name: "an empty comment and an empty quoted string",
      value: 'interia.pl; dkim=pass header.d=c.example () ; x=""',
      expected: true,
    },
    {
      name: "a quoted domain is a placeholder, not a domain",
      value: 'interia.pl; dkim=pass header.d="c.example"',
      expected: false,
    },
    {
      name: "an open comment that ends in a backslash",
      value: "interia.pl; dkim=pass header.d=c.example (a\\",
      expected: false,
    },
    {
      name: "an open quote that ends in a backslash",
      value: 'interia.pl; dkim=pass header.d=c.example; x="a\\',
      expected: false,
    },
    { name: "a lone open parenthesis", value: "interia.pl; dkim=pass header.d=c.example (", expected: false },
    { name: "a lone quote", value: 'interia.pl; dkim=pass header.d=c.example "', expected: false },
    { name: "a stray ) before the result", value: "interia.pl) ; dkim=pass header.d=c.example", expected: false },
    { name: "a ) after a closed comment", value: "interia.pl; dkim=pass header.d=c.example (a))", expected: false },
    {
      name: "spaces around = and tabs before the result",
      value: "interia.pl;\t dkim = pass\theader.d = c.example",
      expected: true,
    },
    {
      name: "full-width letters are folded after the split",
      value: "interia.pl; ｄｋｉｍ=ｐａｓｓ ｈｅａｄｅｒ.ｄ=ｃ.example",
      expected: true,
    },
    { name: "pass and header.d in two results", value: "interia.pl; dkim=pass; header.d=c.example", expected: false },
    { name: "a longer word after pass", value: "interia.pl; dkim=passed header.d=c.example", expected: false },
    { name: "pass at the end of the result with no header.d", value: "interia.pl; dkim=pass", expected: false },
    { name: "header.d glued to a word before it", value: "interia.pl; dkim=pass xheader.d=c.example", expected: false },
    { name: "header.d inside a longer tag", value: "interia.pl; dkim=pass smtp.header.d=c.example", expected: false },
    {
      name: "the signing domain with a trailing dot",
      value: "interia.pl; dkim=pass header.d=c.example.",
      expected: true,
    },
    {
      name: "the signing domain with several trailing dots",
      value: "interia.pl; dkim=pass header.d=c.example..",
      expected: true,
    },
    { name: "header.d with spaces around =", value: "interia.pl; dkim=pass header.d = c.example", expected: true },
    {
      name: "header.d first, then more tags",
      value: "interia.pl; dkim=pass header.d=c.example header.i=@c.example",
      expected: true,
    },
    { name: "an empty header.d", value: "interia.pl; dkim=pass header.d=", expected: false },
    {
      name: "the first part is the id, not a result",
      value: "dkim=pass header.d=c.example; interia.pl",
      expected: false,
    },
  ])("$name", ({ value, expected }) => {
    expect(alignedCovered(value, TRUSTED, "c.example")).toBe(expected);
  });

  test.each([
    { name: "spaces, capitals and a trailing dot", fromDomain: " News.C.Example. ", expected: true },
    { name: "several trailing dots", fromDomain: "news.c.example..", expected: true },
    { name: "only white space", fromDomain: "   ", expected: false },
    {
      name: "a domain below the signing domain with a sibling label",
      fromDomain: "news.other.example",
      expected: false,
    },
  ])("a From domain with $name", ({ fromDomain, expected }) => {
    expect(alignedCovered("interia.pl; dkim=pass header.d=news.c.example", TRUSTED, fromDomain)).toBe(expected);
  });
});

describe("hasCoveredDkimPass", () => {
  const PASS = "interia.pl; dkim=pass header.d=c.example";
  const full = ["from", "list-unsubscribe", "list-unsubscribe-post"];
  const covered = (signatures: DkimSignature[] | null, auth: string | null = PASS, from = "c.example") =>
    hasCoveredDkimPass(auth, TRUSTED, from, signatures);

  test("1: a pass and a signature of that domain that names both headers", () => {
    expect(covered([{ d: "c.example", h: full }])).toBe(true);
  });

  test("2: a signature without `list-unsubscribe-post` or without `list-unsubscribe` is not enough", () => {
    expect(covered([{ d: "c.example", h: ["from", "list-unsubscribe"] }])).toBe(false);
    expect(covered([{ d: "c.example", h: ["from", "list-unsubscribe-post"] }])).toBe(false);
    expect(covered([{ d: "c.example", h: ["from"] }])).toBe(false);
  });

  test("3: a covering signature of another domain does not count", () => {
    expect(covered([{ d: "other.example", h: full }])).toBe(false);
    expect(covered([{ d: "news.c.example", h: full }])).toBe(false);
    expect(
      covered([{ d: "c.example", h: full }], "interia.pl; dkim=pass header.d=other.example", "other.example")
    ).toBe(false);
  });

  test("4: no proof: null (old mail), an empty list, and no pass", () => {
    expect(covered(null)).toBe(false);
    expect(covered([])).toBe(false);
    expect(covered([{ d: "c.example", h: full }], null)).toBe(false);
    expect(covered([{ d: "c.example", h: full }], "evil.example; dkim=pass header.d=c.example")).toBe(false);
    expect(covered([{ d: "c.example", h: full }], "interia.pl; dkim=fail header.d=c.example")).toBe(false);
  });

  test("5: EVERY signature of the passing domain must cover: a covering extra header cannot hide an uncovered one", () => {
    const narrow = { d: "c.example", h: ["from"] };
    const wide = { d: "c.example", h: full };
    expect(covered([narrow, wide])).toBe(false);
    expect(covered([wide, narrow])).toBe(false);
    expect(covered([wide, wide])).toBe(true);
    // A signature of another domain next to it changes nothing.
    expect(covered([wide, { d: "x.example", h: ["from"] }])).toBe(true);
  });

  test("6: a parent domain: header.d of the parent and its signature count for a sub-domain sender", () => {
    expect(covered([{ d: "c.example", h: full }], PASS, "news.c.example")).toBe(true);
    expect(
      covered([{ d: "news.c.example", h: full }], "interia.pl; dkim=pass header.d=news.c.example", "a.news.c.example")
    ).toBe(true);
  });

  test("7: with two passes, one covered pass is enough; a pass of an unaligned domain adds nothing", () => {
    const auth = "interia.pl; dkim=pass header.d=esp.example; dkim=pass header.d=c.example";
    expect(
      covered(
        [
          { d: "c.example", h: full },
          { d: "esp.example", h: ["from"] },
        ],
        auth
      )
    ).toBe(true);
    expect(covered([{ d: "esp.example", h: full }], auth)).toBe(false);
  });
});

describe("the DKIM exports", () => {
  test("8: dkim-pass.ts exports only hasCoveredDkimPass", async () => {
    expect(Object.keys(await import("./dkim-pass")).sort()).toEqual(["hasCoveredDkimPass"]);
  });

  test("9: @ea/core has no hasTrustedAlignedDkimPass and has hasCoveredDkimPass", async () => {
    const core = await import("../index");
    expect(Object.hasOwn(core, "hasTrustedAlignedDkimPass")).toBe(false);
    expect(Object.hasOwn(core, "hasCoveredDkimPass")).toBe(true);
  });
});
