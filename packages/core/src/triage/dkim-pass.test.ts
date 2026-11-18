import { describe, expect, test } from "bun:test";

import { hasTrustedAlignedDkimPass } from "./dkim-pass";

const TRUSTED = ["interia.pl"];

describe("hasTrustedAlignedDkimPass", () => {
  test("1: a trusted id, dkim=pass and header.d of the From domain", () => {
    expect(hasTrustedAlignedDkimPass("interia.pl; dkim=pass header.d=c.example", TRUSTED, "c.example")).toBe(true);
    expect(
      hasTrustedAlignedDkimPass("mx.interia.pl; spf=pass; dkim=pass header.d=c.example", TRUSTED, "c.example")
    ).toBe(true);
  });

  test("2: header.d of a parent of the From domain counts, down to the registrable domain only", () => {
    const pass = (d: string) => `interia.pl; dkim=pass header.d=${d}`;
    expect(hasTrustedAlignedDkimPass(pass("c.example"), TRUSTED, "news.c.example")).toBe(true);
    expect(hasTrustedAlignedDkimPass(pass("news.c.example"), TRUSTED, "a.news.c.example")).toBe(true);
    // A child, a sibling and a public suffix do not count.
    expect(hasTrustedAlignedDkimPass(pass("news.c.example"), TRUSTED, "c.example")).toBe(false);
    expect(hasTrustedAlignedDkimPass(pass("other.c.example"), TRUSTED, "news.c.example")).toBe(false);
    expect(hasTrustedAlignedDkimPass(pass("example"), TRUSTED, "c.example")).toBe(false);
    expect(hasTrustedAlignedDkimPass(pass("co.uk"), TRUSTED, "shop.co.uk")).toBe(false);
    expect(hasTrustedAlignedDkimPass(pass("evilc.example"), TRUSTED, "c.example")).toBe(false);
  });

  test("3: an authserv-id that is not trusted gives false, even with dkim=pass for the right domain", () => {
    expect(hasTrustedAlignedDkimPass("evil.example; dkim=pass header.d=c.example", TRUSTED, "c.example")).toBe(false);
    expect(hasTrustedAlignedDkimPass("notinteria.pl; dkim=pass header.d=c.example", TRUSTED, "c.example")).toBe(false);
    expect(hasTrustedAlignedDkimPass("interia.pl; dkim=pass header.d=c.example", [], "c.example")).toBe(false);
  });

  test("4: dkim=fail, none, a missing header.d, another domain, and a pass in a comment give false", () => {
    const check = (value: string | null) => hasTrustedAlignedDkimPass(value, TRUSTED, "c.example");
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
    expect(hasTrustedAlignedDkimPass("interia.pl; dkim=pass header.d=c.example", TRUSTED, "")).toBe(false);
  });

  test("5: case and a second result: the passing result may follow a failing one", () => {
    expect(
      hasTrustedAlignedDkimPass(
        "Interia.PL; DKIM=Pass Header.D=C.Example; dkim=fail header.d=x.example",
        TRUSTED,
        "c.example"
      )
    ).toBe(true);
    expect(
      hasTrustedAlignedDkimPass(
        "interia.pl; dkim=fail header.d=c.example; dkim=pass header.d=c.example",
        TRUSTED,
        "c.example"
      )
    ).toBe(true);
  });

  // F110 stage 22 review, NOTE 1: the header is lexed per RFC 8601 before it is split on `;`.
  test("6: a `;` or a `dkim=pass` inside a comment or a quoted string never makes a result", () => {
    const check = (value: string) => hasTrustedAlignedDkimPass(value, TRUSTED, "c.example");
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
    const check = (value: string) => hasTrustedAlignedDkimPass(value, TRUSTED, "c.example");
    expect(check("interia.pl; dkim=pass header.d=c.example (open")).toBe(false);
    expect(check('interia.pl; dkim=pass header.d=c.example; x="open')).toBe(false);
    expect(check("interia.pl; dkim=pass header.d=c.example)")).toBe(false);
    expect(check("interia.pl; dkim=pass\u0000 header.d=c.example")).toBe(false);
  });

  test("8: a shared hosting suffix is not a registrable domain: one more label is needed (NOTE 3)", () => {
    const suffixes = [
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
    for (const suffix of suffixes) {
      const pass = (d: string) => `interia.pl; dkim=pass header.d=${d}`;
      // A signature of the suffix does not align with a tenant, and a tenant does not align with a sibling.
      expect({ suffix, ok: hasTrustedAlignedDkimPass(pass(suffix), TRUSTED, `evil.${suffix}`) }).toEqual({
        suffix,
        ok: false,
      });
      expect(hasTrustedAlignedDkimPass(pass(`other.${suffix}`), TRUSTED, `evil.${suffix}`)).toBe(false);
      // The tenant domain and its parents down to the tenant label still align.
      expect(hasTrustedAlignedDkimPass(pass(`evil.${suffix}`), TRUSTED, `evil.${suffix}`)).toBe(true);
      expect(hasTrustedAlignedDkimPass(pass(`evil.${suffix}`), TRUSTED, `news.evil.${suffix}`)).toBe(true);
    }
    // A domain that is not a shared suffix keeps the old rule.
    expect(hasTrustedAlignedDkimPass("interia.pl; dkim=pass header.d=c.example", TRUSTED, "news.c.example")).toBe(true);
  });
});
