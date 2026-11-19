import { describe, expect, test } from "bun:test";

import { addressCaseForms, addressCasedCodePoints, ADDRESS_TRIM_CHARS, normalizeSenderAddress } from "./address";
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

// Ohm U+2126, Kelvin U+212A and Angstrom U+212B are written as escapes.
describe("addressCaseForms", () => {
  const forms = (letter: string): string[] => [...addressCaseForms(letter)].sort();

  test("k: the letter, the capital and the Kelvin sign", () => {
    expect(forms("k")).toEqual(["K", "k", "\u212a"]);
  });

  test("omega: the letter, the capital and the Ohm sign; a-ring: the letter, the capital and the Angstrom sign", () => {
    expect(forms("\u03c9")).toEqual(["\u03a9", "\u03c9", "\u2126"].sort());
    expect(forms("\u00e5")).toEqual(["\u00c5", "\u00e5", "\u212b"].sort());
  });

  test("sharp s: the letter and the capital sharp s", () => {
    expect(forms("\u00df")).toEqual(["\u00df", "\u1e9e"].sort());
  });

  test("the dotless i and the long s have no other form", () => {
    expect(forms("\u0131")).toEqual(["\u0131"]);
    expect(forms("\u017f")).toEqual(["\u017f"]);
  });

  test("sigma: the letter, the capital and the final sigma", () => {
    expect(forms("\u03c3")).toEqual(["\u03a3", "\u03c2", "\u03c3"].sort());
  });

  test("i: the letter, the capital, the dotted capital, and the two with the combining dot", () => {
    expect(forms("i")).toEqual(["I", "I\u0307", "i", "i\u0307", "\u0130"].sort());
    expect(addressCaseForms("i")[0]).toBe("i");
  });

  test("a digit and punctuation have only themselves", () => {
    for (const char of ["1", "@", "."]) expect(addressCaseForms(char)).toEqual([char]);
  });

  test("the letter comes first, and every form folds to the letter under the rule", () => {
    const wrong: string[] = [];
    for (const letter of [
      "a",
      "k",
      "\u00e5",
      "\u03c9",
      "\u00df",
      "\u03c3",
      "i",
      "\u01c6",
      "\u03b8",
      "\u{10428}",
      "x",
    ]) {
      const list = addressCaseForms(letter);
      if (list[0] !== letter) wrong.push(`first ${letter}`);
      for (const form of list) if (normalizeSenderAddress(form) !== letter) wrong.push(`${letter} <- ${form}`);
    }
    expect(wrong).toEqual([]);
  });

  test("no character that folds to a letter is missing, over every code point", () => {
    const missing: string[] = [];
    for (let cp = 1; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const char = String.fromCodePoint(cp);
      const target = normalizeSenderAddress(char);
      if (target === "") continue;
      if (!addressCaseForms(target).includes(char)) missing.push(cp.toString(16));
    }
    expect(missing).toEqual([]);
  });
});

describe("addressCasedCodePoints", () => {
  test("holds the capitals, the Kelvin, Ohm and Angstrom signs, the final sigma and the dotted capital I", () => {
    const cased = new Set(addressCasedCodePoints());
    for (const char of [
      "A",
      "Z",
      "a",
      "z",
      "K",
      "\u212a",
      "\u2126",
      "\u212b",
      "\u03c2",
      "\u0130",
      "\u1e9e",
      "\u00df",
    ]) {
      expect(cased.has(char.codePointAt(0) as number)).toBe(true);
    }
  });

  test("leaves out the dotless i, the long s, digits and punctuation", () => {
    const cased = new Set(addressCasedCodePoints());
    for (const char of ["\u0131", "\u017f", "0", "@", ".", "-"])
      expect(cased.has(char.codePointAt(0) as number)).toBe(false);
  });

  test("ascending, no duplicate, and every case form of a cased letter is in it", () => {
    const list = addressCasedCodePoints();
    expect(list).toEqual([...new Set(list)].sort((a, b) => a - b));
    const cased = new Set(list);
    const missing = ["k", "\u03c3", "i", "\u00e5"].flatMap((letter) =>
      addressCaseForms(letter).filter((form) => [...form].length === 1 && !cased.has(form.codePointAt(0) as number))
    );
    expect(missing).toEqual([]);
  });
});
