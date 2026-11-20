import { describe, expect, test } from "bun:test";

import { failuresOf, say } from "./digits.test-helper";

import { digitVerdict, ibansOf, LONG_SEQUENCE_DIGITS } from "./index";

describe("the long sequence: 12 digits or more that nobody typed (owner answer, F115 stage 01 account check)", () => {
  test("12 digits fail, 11 digits are a phone number: in one run and with one space, dot or dash between runs", () => {
    expect(LONG_SEQUENCE_DIGITS).toBe(12);
    for (const body of [
      "123456789012",
      "1234 5678 9012",
      "1234.5678.9012",
      "1234-5678-9012",
      "12 34 56 78 90 12",
      "1-2-3-4-5-6-7-8-9-0-1-2",
      "123 456 789 012",
      "1234 5678-9012",
      "+48 123 456 789 012",
    ]) {
      expect({ body, failures: failuresOf(say(`konto ${body}`)) }).toEqual({ body, failures: ["account_number"] });
    }
    expect(failuresOf(say("konto 12345678901"))).toEqual(["phone"]);
    expect(failuresOf(say("konto 1234 5678 901"))).toEqual(["phone"]);
    expect(failuresOf(say("konto 123-456-789-01"))).toEqual(["phone"]);
    // Two characters between runs end the sequence but the phone rule still sees the digits.
    expect(failuresOf(say("konto 1234 - 5678 - 9012"))).toEqual(["phone"]);
    expect(failuresOf(say("konto 1234  5678  9012"))).toEqual(["phone"]);
  });

  test("the sequence needs a single separator of the list; a word, a comma or two characters end it", () => {
    for (const body of ["1234 abc 5678 abc 9012", "1234, 5678, 9012", "1234/5678/9012", "1234 5678\n9012"]) {
      expect({ body, failures: failuresOf(say(`konto ${body}`)) }).toEqual({ body, failures: [] });
    }
  });

  test("a date, a time, an amount or a typed number ends the sequence: no sequence of 12 is made across it", () => {
    expect(failuresOf(say("kod 123456 16.07.2026 123456"))).toEqual([]);
    expect(failuresOf(say("kod 123456 zł 123456"))).toEqual([]);
    expect(failuresOf(say("kod 15.11.2026-30.11.2026 oraz 15.11.2026 - 30.11.2026"))).toEqual([]);
    // A typed number inside a longer number does not make the longer number typed.
    expect(failuresOf(say("kod 123456 111222 123456"), ["tel 111222"])).toEqual(["account_number"]);
    expect(failuresOf(say("kod 123456 111 222 123456"), ["tel 111 222"])).toEqual(["account_number"]);
    expect(failuresOf(say("kod 111222 oraz 111 222"), ["tel 111222"])).toEqual([]);
  });

  test("a typed number is allowed whatever its length; another long number is not", () => {
    const typed = ["Nasz numer NIP-EU 1234 5678 9012 oraz konto 61 1090 1014 0000 0712 1981 2874"];
    expect(failuresOf(say("numer 1234 5678 9012"), typed)).toEqual([]);
    expect(failuresOf(say("numer 123456789012"), typed)).toEqual([]);
    expect(failuresOf(say("numer 1234 5678 9013"), typed)).toEqual(["account_number"]);
    expect(failuresOf(say("numer 1234 5678 9012 3456"), typed)).toEqual(["account_number"]);
  });

  test("a number of the mail that the draft answers is allowed up to 26 digits, in one run or in groups; a longer one is not", () => {
    const mail = [
      "Proszę o odpowiedź w sprawie nr 1234 5678 9012 oraz faktury 987654321098 oraz karty 4111 1111 1111 1111.",
    ];
    expect(failuresOf(say("sprawa 1234 5678 9012"), [], mail)).toEqual([]);
    expect(failuresOf(say("sprawa 123456789012"), [], mail)).toEqual([]);
    expect(failuresOf(say("faktura 987654321098"), [], mail)).toEqual([]);
    expect(failuresOf(say("faktura 9876 5432 1098"), [], mail)).toEqual([]);
    expect(failuresOf(say("karta 4111 1111 1111 1111"), [], mail)).toEqual([]);
    expect(failuresOf(say("karta 4111 1111 1111"), [], mail)).toEqual([]);
    expect(failuresOf(say("karta 4111 1111 1111 1112"), [], mail)).toEqual(["account_number"]);
    expect(failuresOf(say("sprawa 1234 5678 9013"), [], mail)).toEqual(["account_number"]);
  });

  test("a mail number made of parts that do not join is not one number: groups with a word between", () => {
    const mail = ["nr 1234 oraz 5678 oraz 9012"];
    expect(failuresOf(say("sprawa 1234 5678 9012"), [], mail)).toEqual(["account_number"]);
  });

  test("a 12-digit sequence in a quoted block or markup is found: the budget layer stays under it", () => {
    expect(failuresOf(say("> 1234 5678 9012"))).toEqual(["account_number"]);
    expect(failuresOf(say("**1234 5678 9012**"))).toEqual(["account_number"]);
    expect(failuresOf(say("1234\u{FE0F} 5678\u{FE0F} 9012"))).toContain("account_number");
  });

  test("one comma between runs does not join them; the longest sequence of the body counts, not the last", () => {
    expect(failuresOf(say("konto 1234,5678,9012"))).toEqual([]);
    expect(failuresOf(say("konto 123456789012 oraz 12"))).toEqual(["account_number"]);
    expect(failuresOf(say("konto 12 oraz 123456789012 oraz 12"))).toEqual(["account_number"]);
    // A typed run after the long one costs nothing: only the sequence rule can find the 12 digits.
    expect(failuresOf(say("konto 123456789012 oraz 111"), ["tel 111"])).toEqual(["account_number"]);
  });

  test("a part of a typed number is typed, at the start, in the middle or at the end", () => {
    const typed = ["konto 1234 5678 9012 3456"];
    expect(failuresOf(say("numer 1234 5678 9012"), typed)).toEqual([]);
    expect(failuresOf(say("numer 5678 9012 3456"), typed)).toEqual([]);
    expect(failuresOf(say("numer 2345 6789 0123"), typed)).toEqual([]);
    expect(failuresOf(say("numer 2345 6789 0124"), typed)).toEqual(["account_number"]);
  });

  test("a mail number: a dot or a dash joins its groups; two characters or a longer number do not", () => {
    for (const mail of ["nr 1234.5678.9012", "nr 1234-5678-9012", "nr 1234 5678 9012"]) {
      expect({ mail, failures: failuresOf(say("sprawa 1234 5678 9012"), [], [mail]) }).toEqual({ mail, failures: [] });
    }
    expect(failuresOf(say("sprawa 1234 5678 9012"), [], ["nr 1234 - 5678 - 9012"])).toEqual(["account_number"]);
    expect(failuresOf(say("sprawa 1234 5678 9012"), [], ["nr 1234, 5678, 9012"])).toEqual(["account_number"]);
    // A part of a mail number of 27 digits or more is not known.
    const long = ["nr 1234 5678 9012 3456 7890 1234 5678"];
    expect(failuresOf(say("sprawa 1234 5678 9012 3456"), [], long)).toEqual(["account_number"]);
    // The groups of a mail number joined by a dot: the last group is added to the number, not put in its place.
    expect(failuresOf(say("sprawa 1234 5678 9012"), [], ["nr 1234.5678.9012"])).toEqual([]);
    expect(failuresOf(say("sprawa 5678 9012"), [], ["nr 1234.5678.9012"])).toEqual([]);
  });

  test("a card or a 12-digit number with a group that has the shape of a year fails (it is no date)", () => {
    const year = ["2024", "1999", "2100", "1900", "2199"];
    for (const group of year) {
      for (const body of [
        `9071 ${group} 1111 1111`,
        `${group} 0337 1901 4893`,
        `9071 0337 ${group} 4893`,
        `9071 0337 1901 ${group}`,
        `9071-${group}-1111-1111`,
        `9071-0337-${group}-4893`,
        `9071 ${group} 1111`,
        `${group} 0337 4893`,
        `9071 0337 ${group}`,
        `9071-${group}-4893`,
        `9071.${group}.4893`,
      ]) {
        expect({ body, failures: failuresOf(say(`karta ${body}`)) }).toEqual({ body, failures: ["account_number"] });
      }
    }
  });

  test("a year of a date still ends the sequence: a date range of 16 digits and a number with a date in it", () => {
    expect(failuresOf(say("kod 15.11.2026-30.11.2026"))).toEqual([]);
    expect(failuresOf(say("kod 4111 15.11.2026 4111"))).toEqual([]);
    expect(failuresOf(say("kod 2024 oraz 1999 oraz 2100"))).toEqual([]);
    // The year of a date ends the sequence.
    expect(failuresOf(say("kod 4111 4111 2026-11-15"))).toEqual([]);
  });

  test("a PL IBAN of the mail repeated as the domestic number (no country letters) passes, by design", () => {
    const mail = ["Proszę o wpłatę na PL61 1090 1014 0000 0712 1981 2874."];
    // The IBAN form is never known: its letters make it an IBAN that nobody typed.
    expect(failuresOf(say("konto PL61 1090 1014 0000 0712 1981 2874"), [], mail)).toEqual(["account_number"]);
    // The same account as the 26 digits of the domestic form is a number of the mail: the user answers that mail.
    expect(failuresOf(say("konto 61 1090 1014 0000 0712 1981 2874"), [], mail)).toEqual([]);
    expect(failuresOf(say("konto 61109010140000071219812874"), [], mail)).toEqual([]);
    // Another number is not.
    expect(failuresOf(say("konto 61 1090 1014 0000 0712 1981 2875"), [], mail)).toEqual(["account_number"]);
  });
});

describe("the typed number keys and the IBAN stream", () => {
  test("a typed number written with dashes is known as one number", () => {
    expect(digitVerdict("Zadzwoń 123456789", { allowed: ["tel. 123-456-789"] })).toEqual({
      account: false,
      phone: false,
    });
    expect(digitVerdict("Zadzwoń 123456789", { allowed: [] })).toEqual({ account: false, phone: true });
  });

  test("typed groups that follow each other after two spaces are one number", () => {
    expect(digitVerdict("Konto 1234 5678 9012", { allowed: ["Konto 1234  5678  9012"] })).toEqual({
      account: false,
      phone: false,
    });
    expect(digitVerdict("Konto 1234 5678 9012", { allowed: [] })).toEqual({ account: true, phone: false });
  });

  test("a letter of another script breaks the stream even when its capital is an ASCII letter", () => {
    expect(ibansOf("Konto IE29AIBK93115212345678.")).toEqual(["IE29AIBK93115212345678"]);
    expect(ibansOf("Konto IE29AıBK93115212345678.")).toEqual([]);
  });
});
