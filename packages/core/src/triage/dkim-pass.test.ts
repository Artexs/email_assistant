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
});
