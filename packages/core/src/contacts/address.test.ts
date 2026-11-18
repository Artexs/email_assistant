import { describe, expect, test } from "bun:test";

import { normalizeSenderAddress } from "./address";

describe("normalizeSenderAddress", () => {
  test("ASCII: trim and lower case", () => {
    expect(normalizeSenderAddress("  Anna@Acme.PL ")).toBe("anna@acme.pl");
  });

  test("Polish letters lower case", () => {
    expect(normalizeSenderAddress("ŁÓDŹ@Żółć.PL")).toBe("łódź@żółć.pl");
  });

  test("Greek: a capital and a lower-case final sigma give the same form", () => {
    expect(normalizeSenderAddress("ΑΝΝΑΣ@x.gr")).toBe("αννασ@x.gr");
    expect(normalizeSenderAddress("αννας@x.gr")).toBe("αννασ@x.gr");
    expect(normalizeSenderAddress("αννασ@x.gr")).toBe("αννασ@x.gr");
  });

  test("Turkish: the dotted capital I gives a plain i, with or without the combining dot", () => {
    expect(normalizeSenderAddress("İSTANBUL@x.tr")).toBe("istanbul@x.tr");
    expect(normalizeSenderAddress("i\u0307stanbul@x.tr")).toBe("istanbul@x.tr");
    expect(normalizeSenderAddress("ISTANBUL@x.tr")).toBe("istanbul@x.tr");
  });

  test("the dotless i stays a dotless i", () => {
    expect(normalizeSenderAddress("ISPARTA@x.tr")).toBe("isparta@x.tr");
    expect(normalizeSenderAddress("ıspar@x.tr")).toBe("ıspar@x.tr");
  });

  test("the rule is idempotent", () => {
    for (const probe of ["ΑΝΝΑΣ@x.gr", "İSTANBUL@x.tr", "ŁÓDŹ@x.pl", "Anna@X.pl", " ς "]) {
      const once = normalizeSenderAddress(probe);
      expect(normalizeSenderAddress(once)).toBe(once);
    }
  });
});
