import { describe, expect, test } from "bun:test";

import { checkStyleSuggestion, STYLE_SUGGESTION_MAX_CHARS, stylistOutputSchema } from "./style-check";
import type { StyleCheckCode } from "./style-check";

const GOOD = "Short, polite sentences. Greets people by the first name. Ends with a short thanks.";

function failuresOf(
  text: string,
  opts: { names?: string[]; samples?: string[]; language?: "pl" | "en" } = {}
): StyleCheckCode[] {
  const result = checkStyleSuggestion(text, { names: [], samples: [], language: "en", ...opts });
  return result.ok ? [] : result.failures;
}

describe("checkStyleSuggestion", () => {
  test("a plain description passes", () => {
    expect(checkStyleSuggestion(GOOD, { names: ["karin"], samples: [], language: "en" })).toEqual({ ok: true });
  });

  test.each([
    ["a name", `${GOOD} Writes to Karin often.`, ["karin"]],
    ["a Polish form of a name", "Greets Marku warmly.", ["marek"]],
  ])("fails on %s", (_label, text, names) => {
    expect(failuresOf(text, { names })).toEqual(["name"]);
  });

  test("a lower-case word that equals a name does not fail", () => {
    expect(failuresOf("Writes the mark of a short note.", { names: ["mark"] })).toEqual([]);
  });

  const rows: [string, string, StyleCheckCode[]][] = [
    ["a phone number", "Uses the number +48 600 100 200.", ["phone"]],
    ["a link", "See https://x.pl", ["link"]],
    ["an address", "a@b.pl", ["address"]],
    ["an account number", "PL61109010140000071219812874", ["account_number"]],
    ["a quote line", "> x", ["quote_line"]],
    ["a bidi control character", "Short notes.\u202e", ["control_chars"]],
  ];
  test.each(rows)("fails on %s", (_label, text, expected) => {
    expect(failuresOf(text)).toEqual(expected);
  });

  test("8 words of a sample in a row fail, with other case and commas", () => {
    const samples = ["Dziękuję za wiadomość, wrócę do Pana w przyszłym tygodniu z odpowiedzią."];
    const copy = "Often: dziękuję, za wiadomość wrócę do pana w przyszłym ale.";
    expect(failuresOf(copy, { samples, language: "pl" })).toEqual(["copied_text"]);
  });

  test("7 words of a sample in a row pass", () => {
    const samples = ["Dziękuję za wiadomość, wrócę do Pana w przyszłym tygodniu z odpowiedzią."];
    expect(failuresOf("Dziękuję za wiadomość wrócę do Pana w ale nie więcej.", { samples, language: "pl" })).toEqual(
      []
    );
  });

  test("words that two samples hold apart do not make a copy", () => {
    const samples = ["one two three four", "five six seven eight"];
    expect(failuresOf("one two three four five six seven eight", { samples })).toEqual([]);
  });

  test("the length limit counts code points", () => {
    const emoji = "😀".repeat(STYLE_SUGGESTION_MAX_CHARS);
    expect(failuresOf(emoji)).toEqual([]);
    expect(failuresOf(`${emoji}😀`)).toEqual(["too_long"]);
    expect(failuresOf("a".repeat(STYLE_SUGGESTION_MAX_CHARS + 1))).toEqual(["too_long"]);
  });

  test("a Polish text for an English style fails", () => {
    expect(failuresOf("Pisze krótko i bardzo uprzejmie. Dziękuję na końcu, nie używa się skrótów.")).toEqual([
      "language",
    ]);
  });

  test("a text with no common word of a language passes", () => {
    expect(failuresOf("Brief, warm.", { language: "pl" })).toEqual([]);
  });

  test("an address and a name give both codes in the order of the list", () => {
    expect(failuresOf("Writes to Karin: k@x.pl", { names: ["karin"] })).toEqual(["address", "name"]);
  });
});

describe("stylistOutputSchema", () => {
  test("accepts a text and trims it", () => {
    expect(stylistOutputSchema.parse({ style: "  Short.  " })).toEqual({ style: "Short." });
  });

  test.each([
    ["an empty text", { style: "" }],
    ["a text of spaces", { style: "   " }],
    ["an extra key", { style: "x", extra: 1 }],
    ["a missing key", {}],
    ["a text over 4,000 code points", { style: "a".repeat(4001) }],
  ])("refuses %s", (_label, value) => {
    expect(stylistOutputSchema.safeParse(value).success).toBe(false);
  });

  test("accepts a text of 1,001 code points, so that the check can retry", () => {
    expect(stylistOutputSchema.safeParse({ style: "a".repeat(1001) }).success).toBe(true);
  });
});
