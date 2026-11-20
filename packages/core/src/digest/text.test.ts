import { describe, expect, test } from "bun:test";

import { textTables } from "../texts";

import { cleanSubject, cutText, senderLabel, withoutEscapeRemains } from "./text";

const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

describe("cutText", () => {
  test("turns control characters into one space", () => {
    expect(cutText("a\nb\tc", 10)).toBe("a b c");
    expect(cutText("a\u0000b", 10)).toBe("a b");
  });

  test.each([
    ["removes the Arabic letter mark", "ab\u061ccd", "abcd"],
    ["removes bidi override characters", "ab\u202ecd", "abcd"],
    ["replaces a lone surrogate", "a\ud800b", "a\ufffdb"],
  ])("%s", (_name, input, text) => {
    expect(cutText(input, 10)).toBe(text);
  });

  test("cuts at max code points with an ellipsis", () => {
    expect(cutText("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  });

  test("never cuts a surrogate pair in half", () => {
    const out = cutText("😀".repeat(20), 5);
    expect(out).toBe(`${"😀".repeat(4)}…`);
    expect(LONE.test(out)).toBe(false);
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

describe("withoutEscapeRemains (F116 review 12, N6)", () => {
  // The same remains in every form that a text channel can carry: raw, single-character CSI, escaped spelling, encoded, full-width,
  // and with invisible characters inside. Each one must leave "red text".
  const FORMS: [string, string][] = [
    ["remains only", "[31mred text[0m"],
    ["raw ESC", "\u001b[31mred text\u001b[0m"],
    ["parameters", "[0;1;31mred text[0m"],
    ["single-character CSI", "\u009b31mred text\u009b0m"],
    ["escaped x1b", "\\x1b[31mred text\\x1b[0m"],
    ["escaped u001b", "\\u001b[31mred text\\u001b[0m"],
    ["octal 033", "\\033[31mred text\\033[0m"],
    ["escaped e", "\\e[31mred text\\e[0m"],
    ["caret notation", "^[[31mred text^[[0m"],
    ["percent encoding", "%1B[31mred text%1b[0m"],
    ["quoted-printable", "=1B[31mred text=1B[0m"],
    ["decimal entity", "&#27;[31mred text&#27;[0m"],
    ["hex entity", "&#x1b;[31mred text&#X1B;[0m"],
    ["full-width", "［３１ｍred text［０ｍ"],
    ["invisible inside", "[3\u200b1\u2060mred text[\u00ad0m"],
    ["variation selector inside", "[31\ufe0fmred text[0m"],
    ["operating-system command", "\u001b]0;evil title\u0007red text"],
    ["operating-system command with ST", "\u001b]8;;http://x.test\u001b\\red text"],
    ["8-bit operating-system command", "\u009d0;evil\u009cred text"],
    // A review finding.
    ["no parameter, reset", "\\e[mred text\\e[m"],
    ["no parameter, erase line", "red text\\e[K"],
    ["raw ESC, no parameter", "\u001b[mred text\u001b[K"],
    ["private mode", "\u001b[?25hred text\u001b[?25l"],
    ["bare private mode", "[?25hred text[?25l"],
    ["colon parameters", "[38:2:255:0:0mred text[0m"],
    ["four digits", "[1000mred text[0m"],
    ["character-set switch", "\u001b(Bred text\\e(0"],
    ["nested", "[[31m31mred text[0m"],
    ["nested twice", "[[[31m31m31mred text"],
  ];
  test.each(FORMS)("%s", (_name, input) => {
    expect(cutText(withoutEscapeRemains(input), 80)).toBe("red text");
  });

  test("an ordinary text with brackets, numbers and letters stays whole", () => {
    for (const text of [
      "see [1a] and [2b] and [10x]",
      "list [1] [2] [3]",
      "Offer [EXT] Q1",
      "5 m and 31 m",
      "price =1 b",
      "a [12;4] range",
      "Re: [ticket 31]",
      // Text in brackets that ends with a letter of a control sequence.
      "Spotkanie [2h] i [10m]",
      "[5s] [3m] [1k] [20h] [4s]",
      "plan [1h]\n[30m] break",
    ]) {
      expect(withoutEscapeRemains(text)).toBe(text);
    }
  });

  test("an unterminated operating-system command removes at most 200 characters", () => {
    const text = `\u001b]0;${"x".repeat(500)}`;
    expect(withoutEscapeRemains(text).length).toBeGreaterThan(290);
  });
});
