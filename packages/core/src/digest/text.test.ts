import { describe, expect, test } from "bun:test";

import { textTables } from "../texts";

import { cleanSubject, cutText, senderLabel } from "./text";

const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

describe("cutText", () => {
  test("turns control characters into one space", () => {
    expect(cutText("a\nb\tc", 10)).toBe("a b c");
    expect(cutText("a\u0000b", 10)).toBe("a b");
  });

  test("removes the Arabic letter mark", () => {
    expect(cutText("ab\u061ccd", 10)).toBe("abcd");
  });

  test("removes bidi override characters", () => {
    expect(cutText("ab\u202ecd", 10)).toBe("abcd");
  });

  test("cuts at max code points with an ellipsis", () => {
    expect(cutText("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  });

  test("never cuts a surrogate pair in half", () => {
    const out = cutText("😀".repeat(20), 5);
    expect(out).toBe(`${"😀".repeat(4)}…`);
    expect(LONE.test(out)).toBe(false);
  });

  test("replaces a lone surrogate", () => {
    expect(cutText("a\ud800b", 10)).toBe("a\ufffdb");
  });
});

describe("cleanSubject", () => {
  test("gives a placeholder for an empty subject", () => {
    expect(cleanSubject(null, textTables.en)).toBe("(no subject)");
    expect(cleanSubject("  ", textTables.en)).toBe("(no subject)");
  });

  test("gives the Polish placeholder for the Polish texts", () => {
    expect(cleanSubject(null, textTables.pl)).toBe("(bez tematu)");
  });

  test("removes links", () => {
    expect(cleanSubject("Pay at https://evil.example/x now", textTables.en)).toBe("Pay at [link] now");
  });
});

describe("senderLabel", () => {
  test("gives a placeholder for a missing sender", () => {
    expect(senderLabel(null, textTables.en)).toBe("(unknown sender)");
  });

  test("gives the Polish placeholder for the Polish texts", () => {
    expect(senderLabel("", textTables.pl)).toBe("(nieznany nadawca)");
  });

  test("keeps the address", () => {
    expect(senderLabel("Ann <ann@firma.test>", textTables.en)).toBe("Ann <ann@firma.test>");
  });
});
