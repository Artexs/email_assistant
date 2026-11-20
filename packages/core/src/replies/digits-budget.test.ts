import { describe, expect, test } from "bun:test";

import { failuresOf, say } from "./digits.test-helper";
import {
  MARKS_AND_SEPARATORS,
  MARKS_BETWEEN_DIGITS,
  TYPED_ACCOUNT_THEN_NEW,
  WORDS_QUOTES_AND_SHAPES,
} from "./reviewer-cases.test-helper";

import { DIGIT_BUDGET, digitVerdict } from "./index";

describe("the digit budget: the reviewer forms of the second re-review (B1 to B4)", () => {
  test("B1: marks between digits hide nothing (four variation selectors, joiners, underlines, keycaps)", () => {
    for (const body of [...MARKS_BETWEEN_DIGITS, ...MARKS_AND_SEPARATORS]) {
      expect({ body: body.slice(0, 60), failures: failuresOf(body) }).toEqual({
        body: body.slice(0, 60),
        failures: ["account_number"],
      });
    }
  });

  test("B2: a typed account number does not allow a new one after it", () => {
    const typed = ["Podaj nasz numer konta PL61 1090 1014 0000 0712 1981 2874 i nr faktury 2026110100001."];
    for (const body of TYPED_ACCOUNT_THEN_NEW) {
      expect({ body: body.slice(30, 100), failures: failuresOf(body, typed) }).toEqual({
        body: body.slice(30, 100),
        failures: ["account_number"],
      });
    }
    // The typed number alone passes, grouped, with another separator, and in one piece.
    expect(failuresOf(say("konto PL61 1090 1014 0000 0712 1981 2874"), typed)).toEqual([]);
    expect(failuresOf(say("konto 61-1090-1014-0000-0712-1981-2874"), typed)).toEqual([]);
    expect(failuresOf(say("konto PL61109010140000071219812874"), typed)).toEqual([]);
    expect(failuresOf(say("faktura 2026110100001"), typed)).toEqual([]);
  });

  test("B3 and B4: a glued currency word, a word, markup, a gap or a quote between the groups", () => {
    for (const body of WORDS_QUOTES_AND_SHAPES.slice(0, 7)) {
      expect({ body: body.slice(25, 90), failures: failuresOf(body) }).toEqual({
        body: body.slice(25, 90),
        failures: ["account_number"],
      });
    }
  });

  test("ordinary business text passes: a date with a time and an amount, a quarter, a period with an amount", () => {
    for (const body of WORDS_QUOTES_AND_SHAPES.slice(8))
      expect({ body, failures: failuresOf(body) }).toEqual({ body, failures: [] });
    const nip = WORDS_QUOTES_AND_SHAPES[7] as string;
    expect(failuresOf(nip, ["NIP PL5739409913"])).toEqual([]);
    // An NIP that nobody typed is a number of 10 digits: a phone number.
    expect(failuresOf(nip)).toEqual(["phone"]);
  });
});

describe("the digit budget: the budget and the phone rule", () => {
  test("12 digits that nothing explains pass, 13 fail", () => {
    expect(DIGIT_BUDGET).toBe(12);
    expect(failuresOf(say("kod abc 4111 abc 1111 abc 1111"))).toEqual([]);
    expect(failuresOf(say("kod abc 4111 abc 1111 abc 1111 abc 1"))).toEqual(["account_number"]);
    expect(failuresOf(say("kod 5 abc 4111 abc 1111 abc 1111 abc"))).toEqual(["account_number"]);
  });

  test("the budget is for the whole body: words, markup and quotes between the groups change nothing", () => {
    for (const body of [
      say("4111 1111 1111 1111"),
      say("4111, numer dalej 1111, a potem 1111 i 1111"),
      say("**4111** **1111** **1111** **1111**"),
      say("<b>4111</b> <b>1111</b> <b>1111</b> <b>1111</b>"),
      say("4111 || 1111 || 1111 || 1111"),
      say("4111\n> 1111\n> > 1111\n> > > 1111"),
      say("4111\u{FE0F}1111\u{FE0F}1111\u{FE0F}1111"),
      say("4-1-1-1-1-1-1-1-1-1-1-1-1-1-1-1"),
    ]) {
      expect({ body, failures: failuresOf(body) }).toEqual({ body, failures: ["account_number"] });
    }
  });

  test("a run of 9 digits that costs something is a phone number; 8 digits are not", () => {
    expect(failuresOf(say("numer 123456789"))).toEqual(["phone"]);
    expect(failuresOf(say("numer 12345678"))).toEqual([]);
    expect(failuresOf(say("tel. +48 600 100 200"))).toEqual(["phone"]);
    expect(failuresOf(say("tel. 600-100-200"))).toEqual(["phone"]);
    expect(failuresOf(say("tel. (22) 600 100 20"))).toEqual(["phone"]);
    expect(failuresOf(say("tel. [22] 600 100 20"))).toEqual(["phone"]);
    expect(failuresOf(say("tel. 600.100.200"))).toEqual(["phone"]);
    // A word between the groups ends the phone run, but the budget still counts the digits.
    expect(failuresOf(say("tel. 600 oraz 100 oraz 200"))).toEqual([]);
  });

  test("a number of 12 digits or more is an account number, not a phone number", () => {
    expect(failuresOf(say("numer 1234567890123"))).toEqual(["account_number"]);
    expect(failuresOf(say("numer 123456789012"))).toEqual(["account_number"]);
    expect(failuresOf(say("numer 12345678901"))).toEqual(["phone"]);
  });

  test("the digit key of a typed phone number: typed in any form, written in any form", () => {
    const typed = ["mój telefon +48 600 100 200"];
    for (const text of ["+48 600 100 200", "600 100 200", "600-100-200", "600100200", "48 600 100 200"]) {
      expect({ text, failures: failuresOf(say(`tel. ${text}`), typed) }).toEqual({ text, failures: [] });
    }
    // A new number of 9 digits or more is a phone number; one group of a typed number that changes costs 3 digits.
    expect(failuresOf(say("tel. 501 777 888"), typed)).toEqual(["phone"]);
    expect(failuresOf(say("tel. 601 100 200"), typed)).toEqual([]);
  });
});

describe("the digit budget: the fold", () => {
  test("fullwidth, Arabic-Indic, Devanagari, mathematical and other digits are ASCII digits", () => {
    for (const digits of [
      "４１１１　１１１１　１１１１　１１１１",
      "٤١١١ ١١١١ ١١١١ ١١١١",
      "४१११ १११ १११ १११ १",
      "𝟒𝟏𝟏𝟏 𝟏𝟏𝟏𝟏 𝟏𝟏𝟏𝟏 𝟏𝟏𝟏𝟏",
    ]) {
      expect({ digits, failures: failuresOf(say(digits)) }).toEqual({ digits, failures: ["account_number"] });
    }
  });

  test("zero-width characters, soft hyphens, combining marks, keycaps and tag characters are removed", () => {
    for (const mark of ["​", "‍", "­", "͏", "̲", "⃣", "\u{e0100}", "᠋", "⁠", "️", "́"]) {
      const body = say(
        `4${mark}1${mark}1${mark}1${mark}1${mark}1${mark}1${mark}1${mark}1${mark}1${mark}1${mark}1${mark}1${mark}1${mark}1`
      );
      expect({ mark, failures: failuresOf(body) }).toMatchObject({
        mark,
        failures: expect.arrayContaining(["account_number"]),
      });
    }
  });

  test("a percent code, an HTML entity and a unicode escape are decoded before the digits are counted", () => {
    expect(failuresOf(say("%34%31%31%31%31%31%31%31%31%31%31%31%31%31"))).toContain("account_number");
    expect(failuresOf(say("&#52;&#49;&#49;&#49;&#49;&#49;&#49;&#49;&#49;&#49;&#49;&#49;&#49;&#49;"))).toContain(
      "account_number"
    );
    expect(
      failuresOf(say("&#x34;&#x31;&#x31;&#x31;&#x31;&#x31;&#x31;&#x31;&#x31;&#x31;&#x31;&#x31;&#x31;&#x31;"))
    ).toContain("account_number");
  });
});

describe("the digit budget: known numbers (typed by the user, or of the quoted mail)", () => {
  const typed = ["Nasz NIP: PL5739409913. Telefon 22 123 45 67. Konto PL61 1090 1014 0000 0712 1981 2874."];

  test("a run that is a part of a typed number is free; a new run is not", () => {
    expect(failuresOf(say("NIP PL5739409913"), typed)).toEqual([]);
    expect(failuresOf(say("NIP 5739409913"), typed)).toEqual([]);
    expect(failuresOf(say("NIP 573 940 9913"), typed)).toEqual([]);
    expect(failuresOf(say("NIP 5739409914"), typed)).toEqual(["phone"]);
    expect(failuresOf(say("NIP 5739409913"))).toEqual(["phone"]);
  });

  test("a run of 1 or 2 digits is never known: one digit of a typed number does not make every digit free", () => {
    const digits = "2 7 1 1 4 0 2 0 0 4 0 0 0 0 3 0 0 2";
    expect(failuresOf(say(`konto ${digits}`), typed)).toEqual(["account_number"]);
    expect(failuresOf(say("konto 27 11 40 20 04 00 00 30 02 01 35"), typed)).toEqual(["account_number"]);
  });

  test("a run of 3 digits is known when it is a part of a typed number", () => {
    expect(failuresOf(say("kod 739 oraz 573 oraz 940 oraz 991 oraz 3 oraz 2 oraz 7 oraz 8"), typed)).toEqual([]);
    expect(
      failuresOf(say("kod 739 oraz 573 oraz 940 oraz 991 oraz 313 oraz 222 oraz 757 oraz 858 oraz 969"), typed)
    ).toEqual(["account_number"]);
  });

  test("the digits of tokens that follow each other form one typed number", () => {
    expect(failuresOf(say("konto 61109010140000071219812874"), typed)).toEqual([]);
    expect(failuresOf(say("konto 6110901014000007121981287"), typed)).toEqual([]);
    expect(failuresOf(say("konto 61109010140000071219812875"), typed)).toEqual(["account_number"]);
    expect(failuresOf(say("telefon 221234567"), typed)).toEqual([]);
  });

  test("the typed number is a number of the typed text only: another body number is not typed", () => {
    expect(failuresOf(say("faktura 2026110100001"), typed)).toEqual(["account_number"]);
    expect(failuresOf(say("faktura 2026110100001"), ["faktura 2026110100001"])).toEqual([]);
  });

  test("quoted mail: a number of 9 to 26 digits is known; a longer one, a number of less than 9 digits in groups, and an IBAN written with its country letters are not", () => {
    const mail = ["Proszę o odpowiedź w sprawie zamówienia 123456789012 oraz 98765432101. Konto: 4111 1111 1111 1111."];
    expect(failuresOf(say("zamówienie 123456789012"), [], mail)).toEqual([]);
    expect(failuresOf(say("zamówienie 98765432101"), [], mail)).toEqual([]);
    expect(failuresOf(say("zamówienie 123456789012"))).toEqual(["account_number"]);
    // The card of the mail, as a whole: the user answers that mail and approves the draft.
    expect(failuresOf(say("konto 4111 1111 1111 1111"), [], mail)).toEqual([]);
    // A number of more than 26 digits is never known; an IBAN of the mail is not known in its IBAN form (country letters).
    const long = ["konto 1234567890123 oraz NL91 ABNA 0417 1643 00 oraz 1234 5678 9012 3456 7890 1234 5678"];
    expect(failuresOf(say("konto 1234567890123"), [], long)).toEqual([]);
    expect(failuresOf(say("konto 1234 5678 9012 3456 7890 1234 5678"), [], long)).toEqual(["account_number"]);
    expect(failuresOf(say("konto NL91ABNA0417164300"), [], long)).toEqual(["account_number"]);
    // The subject counts as quoted mail.
    expect(failuresOf(say("zamówienie 12345678901"), [], ["Re: 12345678901"])).toEqual([]);
  });

  test("a quoted number of 9 to 12 digits does not make its parts free when they are short", () => {
    const mail = ["numer 123456789012"];
    expect(failuresOf(say("kod 12 oraz 34 oraz 56 oraz 78 oraz 90 oraz 12 oraz 11"), [], mail)).toEqual([
      "account_number",
    ]);
  });
});

describe("digitVerdict", () => {
  test("gives account and phone apart: an account excludes a phone", () => {
    expect(digitVerdict(say("tel 600100200"), { allowed: [] })).toEqual({ account: false, phone: true });
    expect(digitVerdict(say("tel 6001002001234"), { allowed: [] })).toEqual({ account: true, phone: false });
    expect(digitVerdict(say("nic"), { allowed: [] })).toEqual({ account: false, phone: false });
  });
});
