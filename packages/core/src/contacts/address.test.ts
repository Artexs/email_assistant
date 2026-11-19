import { describe, expect, test } from "bun:test";

import { ADDRESS_TRIM_CHARS, normalizeSenderAddress } from "./address";
import { ADDRESS_RULE_PROBES } from "./address-probes";

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

describe("ADDRESS_TRIM_CHARS", () => {
  test("a code point is in the set exactly when trim() strips it, over every code point", () => {
    const inSet = new Set([...ADDRESS_TRIM_CHARS].map((c) => c.codePointAt(0)));
    const wrong: string[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = String.fromCodePoint(cp);
      if ((`${c}x${c}`.trim() === "x") !== inSet.has(cp)) wrong.push(cp.toString(16));
    }
    expect(wrong).toEqual([]);
  });

  test("25 code points in ascending order, no duplicate", () => {
    const cps = [...ADDRESS_TRIM_CHARS].map((c) => c.codePointAt(0) as number);
    expect(cps).toHaveLength(25);
    expect(cps).toEqual([...cps].sort((a, b) => a - b));
    expect(new Set(cps).size).toBe(25);
  });
});

describe("ADDRESS_RULE_PROBES", () => {
  test("66 strings; the order is fixed because tests read entries by index", () => {
    expect(ADDRESS_RULE_PROBES).toHaveLength(66);
    expect(ADDRESS_RULE_PROBES[0]).toBe("ANNA\u03a3@x.gr");
    expect(ADDRESS_RULE_PROBES[56]).toBe("\u3000anna@x.test");
  });

  test("the list holds a tab, a no-break space, U+3000 and a newline", () => {
    const joined = ADDRESS_RULE_PROBES.join("");
    for (const c of ["\u0009", "\u00a0", "\u3000", "\u000a"]) expect(joined).toContain(c);
  });

  test("no duplicate entry", () => {
    expect(new Set(ADDRESS_RULE_PROBES).size).toBe(66);
  });
});
