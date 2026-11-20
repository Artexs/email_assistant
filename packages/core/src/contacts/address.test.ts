import { describe, expect, test } from "bun:test";

import {
  addressCaseForms,
  addressCasedCodePoints,
  addressLowerForms,
  ADDRESS_TRIM_CHARS,
  normalizeAddress,
  storedAddressForm,
} from "./address";
import { ADDRESS_RULE_PROBES } from "./address-probes";

// This block comes first on purpose: the case form table is built once, on the first call, and a mutation run credits the
// build only to the test that makes that call. So this test checks the whole table, over every code point, against the rule.
describe("the case form table over every code point", () => {
  test("every group of single code points that fold to one letter is the list of addressCaseForms, in code-point order", () => {
    const groups = new Map<string, string[]>();
    for (let cp = 1; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const char = String.fromCodePoint(cp);
      const target = normalizeAddress(char);
      if (target === "") continue;
      groups.set(target, [...(groups.get(target) ?? []), char]);
    }
    const wrong: string[] = [];
    for (const [target, chars] of groups) {
      const expected = [target, ...chars.filter((char) => char !== target)];
      if (target === "i") expected.push("i\u0307", "I\u0307");
      if (JSON.stringify(addressCaseForms(target)) !== JSON.stringify(expected)) wrong.push(target);
    }
    expect(wrong).toEqual([]);
    expect(groups.size).toBeGreaterThan(1000);
  });

  test("the last code point is its own form", () => {
    expect(addressCaseForms("\u{10ffff}")).toEqual(["\u{10ffff}"]);
  });

  test("a letter that no code point folds to has only itself, and the empty text has no form but itself", () => {
    expect(addressCaseForms("\u03c2")).toEqual(["\u03c2"]);
    expect(addressCaseForms("")).toEqual([""]);
    expect(addressCaseForms(" ")).toEqual([" "]);
  });
});

describe("normalizeAddress", () => {
  test("ASCII: trim and lower case", () => {
    expect(normalizeAddress("  Anna@Acme.PL ")).toBe("anna@acme.pl");
  });

  test("Polish letters lower case", () => {
    expect(normalizeAddress("ŁÓDŹ@Żółć.PL")).toBe("łódź@żółć.pl");
  });

  test("Greek: a capital and a lower-case final sigma give the same form", () => {
    expect(normalizeAddress("ΑΝΝΑΣ@x.gr")).toBe("αννασ@x.gr");
    expect(normalizeAddress("αννας@x.gr")).toBe("αννασ@x.gr");
    expect(normalizeAddress("αννασ@x.gr")).toBe("αννασ@x.gr");
  });

  test("Turkish: the dotted capital I gives a plain i, with or without the combining dot", () => {
    expect(normalizeAddress("İSTANBUL@x.tr")).toBe("istanbul@x.tr");
    expect(normalizeAddress("i\u0307stanbul@x.tr")).toBe("istanbul@x.tr");
    expect(normalizeAddress("ISTANBUL@x.tr")).toBe("istanbul@x.tr");
  });

  test("the dotless i stays a dotless i", () => {
    expect(normalizeAddress("ISPARTA@x.tr")).toBe("isparta@x.tr");
    expect(normalizeAddress("ıspar@x.tr")).toBe("ıspar@x.tr");
  });

  test("the rule is idempotent", () => {
    for (const probe of ["ΑΝΝΑΣ@x.gr", "İSTANBUL@x.tr", "ŁÓDŹ@x.pl", "Anna@X.pl", " ς "]) {
      const once = normalizeAddress(probe);
      expect(normalizeAddress(once)).toBe(once);
    }
  });
});

describe("normalizeAddress, the one export (F142)", () => {
  test("01-T2 pin: printable ASCII gives trim and lower case", () => {
    for (let cp = 0x20; cp <= 0x7e; cp++) {
      const text = `${String.fromCharCode(cp)}A@B.c${String.fromCharCode(cp)}`;
      expect(normalizeAddress(text)).toBe(text.trim().toLowerCase());
    }
    expect(normalizeAddress(" A.B@EXAMPLE.COM ")).toBe(" A.B@EXAMPLE.COM ".trim().toLowerCase());
  });

  test("01-T3 pin: the final sigma forms and the dotted capital I fold", () => {
    for (const text of ["ΝΊΚΟΣ@example.gr", "νίκος@example.gr", "νίκοσ@example.gr"]) {
      expect(normalizeAddress(text)).toBe("νίκοσ@example.gr");
    }
    expect(normalizeAddress("İlker@Example.com")).toBe("ilker@example.com");
  });
});

describe("addressLowerForms", () => {
  test("01-T4 guard: an address without a sigma has one form", () => {
    expect(addressLowerForms("a@example.com")).toEqual(["a@example.com"]);
  });

  test("01-T4 guard: only a word-final sigma takes the final form", () => {
    const forms = addressLowerForms("σοσ.σσ@example.gr");
    expect(forms).toContain("σος.σς@example.gr");
    expect(forms).not.toContain("ςος.σσ@example.gr");
    expect(forms[0]).toBe("σοσ.σσ@example.gr");
  });

  test("01-T4 guard: six word-final sigmas give 16 forms, and each folds back to the input", () => {
    const input = "σ.σ.σ.σ.σ.σ@example.gr";
    const forms = addressLowerForms(input);
    expect(forms).toHaveLength(16);
    expect(new Set(forms).size).toBe(16);
    for (const form of forms) expect(normalizeAddress(form)).toBe(input);
  });
});

describe("storedAddressForm", () => {
  test("01-T7 pin: trim and lower case, no fold (keeps the final sigma)", () => {
    expect(storedAddressForm(" ΝΊΚΟΣ@Example.gr ")).toBe("νίκος@example.gr");
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
      for (const form of list) if (normalizeAddress(form) !== letter) wrong.push(`${letter} <- ${form}`);
    }
    expect(wrong).toEqual([]);
  });

  test("no character that folds to a letter is missing, over every code point", () => {
    const missing: string[] = [];
    for (let cp = 1; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const char = String.fromCodePoint(cp);
      const target = normalizeAddress(char);
      if (target === "") continue;
      if (!addressCaseForms(target).includes(char)) missing.push(cp.toString(16));
    }
    expect(missing).toEqual([]);
  });
});

describe("addressCasedCodePoints", () => {
  // The first call of the list: the exact set, from the rule over every code point, and the same list object on every call.
  test("is exactly the code points that share a form with another code point, ascending, and is built once", () => {
    const groups = new Map<string, number[]>();
    for (let cp = 1; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const target = normalizeAddress(String.fromCodePoint(cp));
      if (target === "") continue;
      groups.set(target, [...(groups.get(target) ?? []), cp]);
    }
    const expected = new Set<number>();
    for (const [target, members] of groups) {
      if (members.length < 2) continue;
      expected.add(target.codePointAt(0) as number);
      for (const member of members) expected.add(member);
    }
    const list = addressCasedCodePoints();
    expect(list).toEqual([...expected].sort((a, b) => a - b));
    expect(list.length).toBeGreaterThan(1000);
    expect(addressCasedCodePoints()).toBe(list);
  });

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
