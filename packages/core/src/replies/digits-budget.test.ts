import { describe, expect, test } from "bun:test";

import { account, accountBody, COUNTRIES, prng, sentence, withCheckDigits } from "./random-accounts.test-helper";
import {
  MARKS_AND_SEPARATORS,
  MARKS_BETWEEN_DIGITS,
  TYPED_ACCOUNT_THEN_NEW,
  WORDS_QUOTES_AND_SHAPES,
} from "./reviewer-cases.test-helper";

import {
  checkReplyBody,
  DIGIT_BUDGET,
  digitVerdict,
  IBAN_LENGTHS,
  ibansOf,
  LONG_SEQUENCE_DIGITS,
  type ReplyCheckCode,
} from "./index";

function failuresOf(body: string, allowed: string[] = [], quoted: string[] = []): ReplyCheckCode[] {
  const result = checkReplyBody(body, { language: "pl", allowed, quoted });
  return result.ok ? [] : result.failures;
}

const say = (text: string): string => `Dzień dobry, ${text} dziękuję bardzo.`;

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

describe("the digit budget: free numbers (dates, times, money, percentages, postal codes, years, amounts)", () => {
  const free = [
    "16.07.2026, 09:00 – 15 976,39 zł",
    "okres 15.02.2027–27.03.2027 (26 883,20 zł)",
    "Q3 2026: €385 559,00",
    "13 | €700.21 | 2025-04-20",
    "faktura FV/2024/05/1234 na €647,00",
    "NIP PL5739409913 oraz 05 stycznia 2027 oraz 12 lutego 2027",
    "adres: ul. Polna 174/80, 96-358 Warszawa",
    "rabat 15% oraz 10–23% oraz 9,8%",
    "kurs 5,7635 zł/EUR z 01.02.2027",
    "termin 1.1.2027, 31.12.2199, 2027-1-1, 31/12/2027",
    "godziny 9:00-17:00, 23:59:59, 0:00",
    "kwota 1 250 000,00 zł, 12 500 000 PLN, 123 456 789 zł",
    "kwota €123 456 789 oraz 1.250.000,00 EUR",
    "raty: 1 200 zł, 1 200 zł, 1 200 zł, 1 200 zł, 1 200 zł",
  ];
  for (const text of free) {
    test(`${JSON.stringify(text)} passes`, () => {
      const allowed = text.includes("NIP") ? ["NIP PL5739409913"] : [];
      expect(failuresOf(say(text), allowed)).toEqual([]);
    });
  }

  test("a date that is no date costs its digits", () => {
    for (const date of [
      "32.01.2026",
      "31.13.2026",
      "00.01.2026",
      "01.00.2026",
      "15.11.1899",
      "15.11.2200",
      "2026-13-01",
      "2026-01-32",
    ]) {
      expect({ date, failures: failuresOf(say(`kod ${date} oraz ${date} oraz ${date} oraz ${date}`)) }).toEqual({
        date,
        failures: ["account_number"],
      });
    }
    for (const time of ["24:00", "12:60", "12:34:60"]) {
      expect({ time, failures: failuresOf(say(`kod ${time} oraz ${time} oraz ${time} oraz ${time}`)) }).toEqual({
        time,
        failures: ["account_number"],
      });
    }
  });

  test("each separator and each form of a date is free", () => {
    for (const date of [
      "1.1.2027",
      "1/1/2027",
      "1-1-2027",
      "2027.1.1",
      "2027/1/1",
      "2027-1-1",
      "01.01.2027",
      "1 stycznia 2027",
      "1 January 2027",
      "H1 2027",
    ]) {
      const body = say(`kod ${date} oraz ${date} oraz ${date} oraz ${date}`);
      expect({ date, failures: failuresOf(body) }).toEqual({ date, failures: [] });
    }
    for (const date of ["11.1.20271", "111.1.2027", "12027-1-1", "2027-1-100", "1 stycznia 20271"]) {
      expect({ date, failures: failuresOf(say(`kod ${date} oraz ${date} oraz ${date} oraz ${date}`)) }).toEqual({
        date,
        failures: ["account_number"],
      });
    }
  });

  test("every currency word and sign makes an amount free, before or after it, up to 9 integer digits", () => {
    const currencies = [
      "zł",
      "zl",
      "pln",
      "PLN",
      "eur",
      "EUR",
      "usd",
      "USD",
      "gbp",
      "GBP",
      "chf",
      "CHF",
      "czk",
      "CZK",
      "euro",
      "euros",
      "dolarów",
      "dolary",
      "złotych",
      "złoty",
      "złotówek",
      "€",
      "$",
      "£",
    ];
    for (const currency of currencies) {
      for (const amount of ["123 456 789", "123456789", "12 345 678", "7", "1.250.000"]) {
        const after = say(`kod ${amount} ${currency} i ${amount} ${currency} i ${amount} ${currency}`);
        expect({ after, failures: failuresOf(after) }).toEqual({ after, failures: [] });
        const before = say(`kod ${currency} ${amount} i ${currency} ${amount} i ${currency} ${amount}`);
        expect({ before, failures: failuresOf(before) }).toEqual({ before, failures: [] });
      }
      // 10 integer digits are no free amount.
      expect(failuresOf(say(`kod 1234567890 ${currency}`))).toEqual(["phone"]);
      expect(failuresOf(say(`kod ${currency} 1234567890`))).toEqual(["phone"]);
    }
  });

  test("an amount stands alone: a letter or a digit glued to it, or a currency inside a word, makes it no amount", () => {
    expect(failuresOf(say("kod Q35630227 USD"))).toEqual([]);
    expect(failuresOf(say("kod ABCEUR 123456789"))).toEqual(["phone"]);
    expect(failuresOf(say("kod 123456789 EURX"))).toEqual(["phone"]);
    expect(failuresOf(say("kod 123456789 EUR2"))).toEqual(["phone"]);
    expect(failuresOf(say("kod EUR 123456789x"))).toEqual(["phone"]);
    expect(failuresOf(say("kod 12 123456789 zł"))).toEqual(["phone"]);
  });

  test("a number cut into amounts is no amount: the digit next to a currency is explained or it costs", () => {
    expect(failuresOf(say("kod USD 4111 1111 1111 1111"))).toEqual(["account_number"]);
    expect(failuresOf(say("kod 4111 1111 1111 1111 dolarów"))).toEqual(["account_number"]);
    expect(failuresOf(say("kod zł 4111, 1111, 1111, 1111"))).toEqual(["account_number"]);
    expect(failuresOf(say("kod 4111 / 1111 / 1111 / 1111 zł"))).toEqual(["account_number"]);
    expect(failuresOf(say("kod 4111 1111 1111 1111 PLN"))).toEqual(["account_number"]);
    expect(failuresOf(say("kod PLN 4111 1111 1111 1111"))).toEqual(["account_number"]);
  });

  test("an amount next to a date or a time is free; an amount next to an unexplained digit run is not", () => {
    expect(failuresOf(say("16.07.2026, 09:00 – 15 976 zł"))).toEqual([]);
    expect(failuresOf(say("15 976 zł 16.07.2026, 09:00"))).toEqual([]);
    expect(failuresOf(say("kod 12345 6789 4321 zł"))).toEqual(["account_number"]);
    expect(failuresOf(say("kod zł 4321 12345 6789"))).toEqual(["account_number"]);
  });

  test("the free numbers of one body are limited to 40 digits", () => {
    const amounts = Array.from({ length: 6 }, () => "123 456 789 zł").join(", ");
    expect(failuresOf(say(`raty ${amounts}`))).toEqual(["account_number"]);
    const fewer = Array.from({ length: 4 }, () => "123 456 789 zł").join(", ");
    expect(failuresOf(say(`raty ${fewer}`))).toEqual([]);
  });

  test("a number of the form of money has two decimals and at most 9 integer digits", () => {
    for (const money of ["784,00", "784.00", "1 250,50", "12.345.678,90", "123456789,99", "1,234,567.89"]) {
      const body = say(`kwota ${money} oraz ${money} oraz ${money}`);
      expect({ money, failures: failuresOf(body) }).toEqual({ money, failures: [] });
    }
    // 10 integer digits, 3 decimals, a letter or a digit glued to it: no money.
    for (const money of ["1234567890,00", "784,000", "x784,00", "784,00x", "1 784,00 5"]) {
      const body = say(`kod ${money} oraz ${money} oraz ${money}`);
      expect({ money, failures: failuresOf(body) }).not.toEqual({ money, failures: [] });
    }
  });

  test("a percentage, a rate, a postal code and a year are free", () => {
    for (const text of [
      "15%",
      "15 %",
      "9,8%",
      "10–23%",
      "10-23 %",
      "5,7635",
      "5.76",
      "96-358",
      "2027",
      "1900",
      "2199",
    ]) {
      const body = say(`kod ${text} oraz ${text} oraz ${text} oraz ${text} oraz ${text}`);
      expect({ text, failures: failuresOf(body) }).toEqual({ text, failures: [] });
    }
    for (const text of ["1899", "2200", "96-3589", "960-358", "123,12345", "1234%"]) {
      const body = say(`kod ${text} oraz ${text} oraz ${text} oraz ${text}`);
      expect({ text, failures: failuresOf(body) }).not.toEqual({ text, failures: [] });
    }
  });
});

describe("the digit budget: an IBAN is an IBAN whatever its digits cost (mod 97)", () => {
  const registry =
    "AD1200012030200359100100 AE070331234567890123456 AL47212110090000000235698741 AT611904300234573201 AZ21NABZ00000000137010001944 BA391290079401028494 BE68539007547034 BG80BNBG96611020345678 BH67BMAG00001299123456 BR1800360305000010009795493C1 BY13NBRB3600900000002Z00AB00 CH9300762011623852957 CR05015202001026284066 CY17002001280000001200527600 CZ6508000000192000145399 DE89370400440532013000 DK5000400440116243 DO28BAGR00000001212453611324 EE382200221020145685 EG380019000500000000263180002 ES9121000418450200051332 FI2112345600000785 FO6264600001631634 FR1420041010050500013M02606 GB29NWBK60161331926819 GE29NB0000000101904917 GI75NWBK000000007099453 GL8964710001000206 GR1601101250000000012300695 GT82TRAJ01020000001210029690 HR1210010051863000160 HU42117730161111101800000000 IE29AIBK93115212345678 IL620108000000099999999 IQ98NBIQ850123456789012 IS140159260076545510730339 IT60X0542811101000000123456 JO94CBJO0010000000000131000302 KW81CBKU0000000000001234560101 KZ86125KZT5004100100 LB62099900000001001901229114 LC55HEMM000100010012001200023015 LI21088100002324013AA LT121000011101001000 LU280019400644750000 LV80BANK0000435195001 LY83002048000020100120361 MC5811222000010123456789030 MD24AG000225100013104168 ME25505000012345678951 MK07250120000058984 MR1300020001010000123456753 MT84MALT011000012345MTLCAST001S MU17BOMM0101101030300200000MUR NL91ABNA0417164300 NO9386011117947 PK36SCBL0000001123456702 PL61109010140000071219812874 PS92PALS000000000400123456702 PT50000201231234567890154 QA58DOHB00001234567890ABCDEFG RO49AAAA1B31007593840000 RS35260005601001611379 SA0380000000608010167519 SC18SSCB11010000000000001497USD SE4550000000058398257466 SI56263300012039086 SK3112000000198742637541 SM86U0322509800000000270100 ST68000100010051845310112 SV62CENR00000000000000700025 TL380080012345678910157 TN5910006035183598478831 TR330006100519786457841326 UA213223130000026007233566001 VA59001123000012345678 VG96VPVG0000012345678901 XK051212012345678906 SD2129010501234001 SO211000001001000100141 FK88SC123456789012 MN121234123456789123 OM810180000001299123456 YE15CBYE0001018861234567891234".split(
      " "
    );

  test("the length table agrees with the registry examples: each example is found, whole", () => {
    expect(registry.length).toBe(84);
    const countries = new Set(registry.map((iban) => iban.slice(0, 2)));
    expect(countries.size).toBe(84);
    for (const iban of registry) {
      expect({ iban, found: ibansOf(`Konto ${iban}.`) }).toEqual({ iban, found: [iban] });
      expect(IBAN_LENGTHS[iban.slice(0, 2)]).toBe(iban.length);
    }
    expect(Object.keys(IBAN_LENGTHS)).toHaveLength(87);
  });

  test("a registry IBAN fails in any form, also with few digits", () => {
    const seps = [" ", "\n", " / ", " | ", ", ", "\t", " = ", " * ", ".", "-", "_", " "];
    for (const iban of registry) {
      for (const sep of seps) {
        const grouped = iban.match(/.{1,4}/g)?.join(sep) ?? iban;
        for (const text of [
          grouped,
          `pln${iban.slice(0, 2)}${sep}${iban.slice(2, 4)}${sep}${iban.slice(4)}`,
          `${iban.toLowerCase()}`,
        ]) {
          expect({ text, failures: failuresOf(say(`przelew ${text}`)) }).toEqual({
            text,
            failures: ["account_number"],
          });
        }
      }
    }
  });

  test("a typed IBAN passes in the body; another IBAN does not", () => {
    expect(failuresOf(say("konto NL91 ABNA 0417 1643 00"), ["Konto: NL91ABNA0417164300"])).toEqual([]);
    expect(failuresOf(say("konto NL91 ABNA 0417 1643 00"), ["Konto: NL 91 ABNA 0417 1643 00 PLN"])).toEqual([]);
    expect(failuresOf(say("konto GB29 NWBK 6016 1331 9268 19"), ["Konto: NL91ABNA0417164300"])).toEqual([
      "account_number",
    ]);
  });

  test("the letters of markup tags and quote marks are no part of the IBAN; a word ends the stream", () => {
    expect(failuresOf(say("<b>NL91</b> <b>ABNA</b> <b>0417</b> <b>1643</b> <b>00</b>"))).toEqual(["account_number"]);
    expect(failuresOf(say("NL91<Y>ABNA0417164300"))).toEqual(["account_number"]);
    expect(
      ibansOf("Termin dostawy: do 13.5.2025, ilość: 21 sztuk. Pozdrawiam serdecznie, jest to dla mnie ważne.")
    ).toEqual([]);
    expect(ibansOf("W dniach 8-27.04.2027 nie ma mnie.")).toEqual([]);
    expect(ibansOf("Nakład 275 496 egzemplarzy w cenie 331843.50 zł.")).toEqual([]);
  });

  test("an IBAN of a country of the registry with a wrong length or wrong check digits is no IBAN by mod 97", () => {
    expect(ibansOf("NL91ABNA041716430")).toEqual([]);
    expect(ibansOf("NL92ABNA0417164300")).toEqual([]);
    expect(ibansOf("XX91ABNA0417164300")).toEqual([]);
    expect(ibansOf("NL91ABNA0417164300")).toEqual(["NL91ABNA0417164300"]);
    expect(ibansOf("nl91abna0417164300")).toEqual(["NL91ABNA0417164300"]);
  });

  test("an IBAN of the quoted mail is never trusted", () => {
    expect(failuresOf(say("konto NL91ABNA0417164300"), [], ["Nowe konto NL91ABNA0417164300"])).toEqual([
      "account_number",
    ]);
  });
});

describe("the digit budget: random accounts and ordinary sentences (seeded)", () => {
  for (const country of COUNTRIES) {
    test(`300 random ${country} accounts, random separators and currencies: ${country === "CARD" ? "at most 14 % pass" : "none passes"}`, () => {
      const r = prng(5000 + country.charCodeAt(0) * 31 + country.charCodeAt(1));
      let misses = 0;
      for (let i = 0; i < 300; i += 1) {
        const { body } = accountBody(r, country);
        if (!failuresOf(body).includes("account_number")) misses += 1;
      }
      // A card of 13 to 16 digits has 1 to 4 digits of slack in the budget: a group that looks like a date, a year or a
      // rate can pass. The numbers of an IBAN never pass: its digits, or mod 97, find it.
      expect(misses).toBeLessThanOrEqual(country === "CARD" ? 42 : 0);
    });
  }

  test("a valid IBAN helper: the check digits make mod 97 pass", () => {
    const r = prng(1);
    for (const country of COUNTRIES.filter((c) => c !== "CARD")) {
      const iban = account(r, country);
      expect(ibansOf(iban)).toEqual([iban]);
      expect(withCheckDigits(iban)).toBe(iban);
    }
  });

  test("1,000 ordinary Polish business sentences: at most 1 % fail", () => {
    const r = prng(777);
    let bad = 0;
    for (let i = 0; i < 1000; i += 1) if (failuresOf(sentence(r)).length > 0) bad += 1;
    expect(bad).toBeLessThanOrEqual(10);
  });
});

describe("digitVerdict", () => {
  test("gives account and phone apart: an account excludes a phone", () => {
    expect(digitVerdict(say("tel 600100200"), { allowed: [] })).toEqual({ account: false, phone: true });
    expect(digitVerdict(say("tel 6001002001234"), { allowed: [] })).toEqual({ account: true, phone: false });
    expect(digitVerdict(say("nic"), { allowed: [] })).toEqual({ account: false, phone: false });
  });
});

// ---- pins of the single rules (each line is the test of a mutation) --------------------------------------------------

const repeat = (text: string, times: number): string => Array.from({ length: times }, () => text).join(" oraz ");
const letterIban = (country: string): string => {
  const length = IBAN_LENGTHS[country] as number;
  return withCheckDigits(`${country}00${"ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(2).slice(0, length - 4)}`);
};

describe("pins: the quoted mail", () => {
  test("a number of the mail is known from 9 to 26 digits", () => {
    for (const [digits, passes] of [
      ["12345678", false],
      ["123456789", true],
      ["123456789012", true],
      ["1234567890123", true],
      ["12345678901234567890123456", true],
      ["123456789012345678901234567", false],
    ] as const) {
      const failures = failuresOf(say(`zamówienie ${repeat(digits, 2)}`), [], [`numer ${digits}`]);
      expect({ digits, failures }).toEqual({ digits, failures: passes ? [] : [expect.any(String)] });
    }
  });
});

describe("pins: dates, times and periods", () => {
  const free = (text: string, times: number): ReplyCheckCode[] => failuresOf(say(`kod ${repeat(text, times)}`));

  test("a free run leaves a break: a phone number does not join across a date", () => {
    expect(failuresOf(say("kod 600 16.07.2026 100 200"))).toEqual([]);
  });

  test("each separator of a day-first and a year-first date", () => {
    for (const date of [
      "1.1.2027",
      "1/1/2027",
      "1-1-2027",
      "2027.1.1",
      "2027/1/1",
      "2027-1-1",
      "01.01.2027",
      "2027-01-01",
    ]) {
      expect({ date, failures: free(date, 8) }).toEqual({ date, failures: [] });
    }
    // Day first with a day above 12, year first with a day above 12: day and month are not swapped.
    for (const date of ["31.12.2027", "31/12/2027", "31-12-2027", "2027-12-31", "2027.12.31", "2027/12/31"]) {
      expect({ date, failures: free(date, 5) }).toEqual({ date, failures: [] });
    }
    for (const date of ["12.31.2027", "2027-31-12"]) {
      expect({ date, failures: free(date, 5) }).toEqual({ date, failures: ["account_number"] });
    }
  });

  test("a date is no date inside a longer number", () => {
    for (const text of ["11.1.20271", "111.1.2027", "12027-1-1", "2027-1-100", "12027.1.1", "2027.1.100"]) {
      expect({ text, failures: free(text, 4) }).toEqual({ text, failures: ["account_number"] });
    }
  });

  test("the limits of a time: 23:59:59 is a time, 24:00, 12:60 and 12:34:60 are not", () => {
    expect(free("12:34:59", 3)).toEqual([]);
    expect(free("23:59", 4)).toEqual([]);
    expect(free("0:00", 13)).toEqual([]);
    for (const text of ["24:00", "12:60", "12:34:60"])
      expect({ text, failures: free(text, 4) }).toEqual({ text, failures: ["account_number"] });
    expect(free("1234:56", 3)).toEqual(["account_number"]);
    expect(free("12:345", 3)).toEqual(["account_number"]);
  });

  test("a date with the month in words: every month, a day of 1 or 2 digits, a year", () => {
    const months = [
      "stycznia",
      "lutego",
      "marca",
      "kwietnia",
      "maja",
      "czerwca",
      "lipca",
      "sierpnia",
      "września",
      "października",
      "listopada",
      "grudnia",
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ];
    for (const month of months) {
      expect({ month, failures: free(`12 ${month} 2027`, 8) }).toEqual({ month, failures: [] });
      expect({ month, failures: free(`3 ${month} 2027`, 13) }).toEqual({ month, failures: [] });
    }
    expect(free("32 stycznia 2027", 7)).toEqual(["account_number"]);
    expect(free("12 stycznia 1850", 3)).toEqual(["account_number"]);
    expect(free("112 stycznia 2027", 5)).toEqual(["account_number"]);
    expect(free("12 stycznia 20271", 3)).toEqual(["account_number"]);
    expect(free("12 stycznia2027", 5)).toEqual(["account_number"]);
  });

  test("a quarter or a half-year with its year", () => {
    expect(free("Q3 2025", 13)).toEqual([]);
    expect(free("q1 2025", 13)).toEqual([]);
    expect(free("H1 2025", 13)).toEqual([]);
    expect(free("H4 2025", 13)).toEqual([]);
    for (const text of ["Q5 2025", "Q0 2025", "xQ3 2025", "Q3 20251", "Q3 1850", "Q32025"]) {
      expect({ text, failures: free(text, 13) }).toEqual({ text, failures: ["account_number"] });
    }
  });
});

describe("pins: money, percentages, rates, postal codes, years", () => {
  const free = (text: string, times: number): ReplyCheckCode[] => failuresOf(say(`kod ${repeat(text, times)}`));
  const costs = (text: string, times: number): boolean => free(text, times).length > 0;

  test("money has two decimals", () => {
    expect(free("784,00", 8)).toEqual([]);
    expect(costs("784,5", 4)).toBe(true);
    expect(costs("784,500", 4)).toBe(true);
  });

  test("a percentage: decimals, a range, spaces, standing alone", () => {
    expect(free("100,5%", 4)).toEqual([]);
    expect(free("9,8%", 13)).toEqual([]);
    expect(free("10–23%", 7)).toEqual([]);
    expect(free("10 - 23%", 7)).toEqual([]);
    expect(free("10-23 %", 7)).toEqual([]);
    expect(free("15 %", 13)).toEqual([]);
    expect(costs("x15%", 7)).toBe(true);
    expect(costs("1234%", 4)).toBe(true);
  });

  test("a rate: one or two integer digits, one to four decimals, a comma or a dot", () => {
    expect(free("12,5", 5)).toEqual([]);
    expect(free("5,7635", 4)).toEqual([]);
    expect(free("5.7635", 4)).toEqual([]);
    expect(free("5,7", 13)).toEqual([]);
    expect(costs("123,5", 4)).toBe(true);
    expect(costs("5,76543", 3)).toBe(true);
    expect(costs("x5,7635", 3)).toBe(true);
    expect(costs("5,7635x", 3)).toBe(true);
    expect(costs("5,7635 6", 3)).toBe(true);
  });

  test("a postal code: two digits, a hyphen, three digits, standing alone", () => {
    expect(free("96-358", 6)).toEqual([]);
    for (const text of ["96-3589", "12-96-358", "x96-358", "96-358x", "96-358-1", "6-358"]) {
      expect({ text, failures: free(text, 4) }).toEqual({ text, failures: ["account_number"] });
    }
  });

  test("a year: 1900 to 2199, standing alone", () => {
    for (const year of ["1900", "1999", "2000", "2027", "2199"])
      expect({ year, failures: free(year, 6) }).toEqual({ year, failures: [] });
    for (const year of ["1899", "2200", "x2027", "12027", "20271"]) {
      expect({ year, failures: free(year, 4) }).not.toEqual({ year, failures: [] });
    }
  });
});

describe("pins: amounts next to a currency", () => {
  const free = (text: string, times: number): ReplyCheckCode[] => failuresOf(say(`kod ${repeat(text, times)}`));

  test("decimals and groups of an amount", () => {
    expect(free("123 456 789,5 zł", 3)).toEqual([]);
    expect(free("123 456 789,50 zł", 3)).toEqual([]);
    expect(free("1,234,567 zł", 3)).toEqual([]);
    expect(free("1.234.567 zł", 3)).toEqual([]);
    expect(free("1 234 567 zł", 3)).toEqual([]);
    expect(free("zł 1,234,567", 3)).toEqual([]);
    expect(free("123 456 789,501 zł", 2)).toEqual(["account_number"]);
  });

  test("an amount stands alone: nothing glued before it, a digit and a separator before it", () => {
    expect(free("x1234 zł", 4)).toEqual(["account_number"]);
    expect(free("12usd 123", 5)).toEqual(["account_number"]);
    expect(free("16.07.2026 1111 zł", 4)).toEqual(["account_number"]);
    expect(free("usd 12,34567", 3)).toEqual(["account_number"]);
    expect(free("usd 123 45", 3)).toEqual(["account_number"]);
    expect(free("usd 123x", 5)).toEqual(["account_number"]);
    expect(free("usd 123.4.5", 4)).not.toEqual([]);
  });

  test("only a date, a time, the mail or a typed number may stand next to an amount without a letter", () => {
    expect(free("16.07.2026, 09:00 – 15 976 zł", 3)).toEqual([]);
    expect(free("15 976 zł – 16.07.2026, 09:00", 3)).toEqual([]);
    expect(free("15% 1234 zł", 4)).toEqual(["account_number"]);
    expect(free("usd 1234, 15%", 4)).toEqual(["account_number"]);
    // The run next to the amount counts, not the run after it.
    expect(free("usd 123, 4567 16.07.2026", 2)).toEqual(["account_number"]);
    expect(free("16.07.2026 4567, 123 zł", 2)).toEqual(["account_number"]);
  });

  test("a typed number may stand next to an amount", () => {
    expect(failuresOf(say(repeat("tel 111222333 12 zł", 4)), ["111222333"])).toEqual([]);
  });
});

describe("pins: the limit of the free numbers", () => {
  const postals = (count: number): string => repeat("96-358", count);
  const unknown = "kod 4111 abc 1111 abc 1111";

  test("40 digits of money, rates, postal codes and years are free, the 41st costs", () => {
    expect(failuresOf(say(`${postals(8)} oraz ${unknown}`))).toEqual([]);
    expect(failuresOf(say(`${postals(8)} oraz 5% oraz ${unknown}`))).toEqual(["account_number"]);
    expect(failuresOf(say(`${postals(12)}`))).toEqual(["account_number"]);
    expect(failuresOf(say(`${postals(9)}`))).toEqual([]);
  });

  test("the free numbers are taken in the order of the text", () => {
    expect(
      failuresOf(say(`${postals(7)} oraz 2027 oraz 1% oraz 1999 oraz ${unknown.replace(" 1111 abc 1111", " 1111")}`))
    ).toEqual([]);
  });

  test("the digits of amounts count in the same limit, in the order of the text", () => {
    const big = repeat("123 456 789 zł", 4);
    expect(failuresOf(say(`${big} oraz 12 345 zł oraz 1 234 zł oraz kod 4111 abc 111`))).toEqual([]);
    expect(failuresOf(say(`${big} oraz 12 345 zł oraz 1 234 zł oraz 5 zł oraz kod 4111 abc 1111`))).toEqual([
      "account_number",
    ]);
  });
});

describe("pins: typed numbers", () => {
  test("the numbers of a typed text that follow each other form one number, but a word ends it", () => {
    expect(failuresOf(say(repeat("111222", 3)), ["kod 111 222"])).toEqual([]);
    expect(failuresOf(say(repeat("111222", 3)), ["kod 111\nfoo\n222"])).toEqual(["account_number"]);
    expect(failuresOf(say(repeat("111222", 3)), ["kod 111\n222"])).toEqual([]);
    expect(failuresOf(say(repeat("111222", 3)), ["kod 111\t222"])).toEqual([]);
  });

  test("a typed number is read as it is: the plain text", () => {
    expect(failuresOf(say(repeat("600100", 3)), ["kod 600 100"])).toEqual([]);
    expect(failuresOf(say(repeat("600100", 3)), ["kod 600%20100"])).toEqual(["account_number"]);
  });
});

describe("pins: the views of the body", () => {
  test("the plain view and the decoded view are both counted; the cost of the larger one counts", () => {
    // Plain: 6, 20000, 20111 and 20222 are 16 digits. Decoded: 6 000 111 222 are 10 digits and a phone number.
    expect(failuresOf(say("tel 6%20000%20111%20222"))).toEqual(["account_number"]);
    expect(failuresOf(say("tel 6 000 111 222"))).toEqual(["phone"]);
    expect(failuresOf(say("tel &#54;&#48;&#48; &#49;&#48;&#48; &#50;&#48;&#48;"))).toEqual(["account_number"]);
  });
});

describe("pins: the IBAN scan", () => {
  test("the lengths of the three countries without a registry example", () => {
    expect([IBAN_LENGTHS.BI, IBAN_LENGTHS.DJ, IBAN_LENGTHS.NI]).toEqual([27, 27, 28]);
  });

  test("every country of the table: a valid IBAN with few digits is found", () => {
    expect(Object.keys(IBAN_LENGTHS)).toHaveLength(87);
    for (const country of Object.keys(IBAN_LENGTHS)) {
      const iban = letterIban(country);
      expect({ country, length: iban.length }).toEqual({ country, length: IBAN_LENGTHS[country] as number });
      expect({ country, found: ibansOf(iban) }).toEqual({ country, found: [iban] });
      expect({ country, failures: failuresOf(say(iban)) }).toEqual({ country, failures: ["account_number"] });
    }
  });

  test("the candidate: a registry country, two digits, the full length, no break, mod 97", () => {
    const valid = letterIban("MT");
    expect(ibansOf(valid)).toEqual([valid]);
    // Another country code with the same shape and valid check digits.
    expect(ibansOf(withCheckDigits(`XX00${valid.slice(4, 24)}`))).toEqual([]);
    // Too short: valid check digits for a shorter text.
    expect(ibansOf(withCheckDigits(valid.slice(0, 30)))).toEqual([]);
    // A letter in the place of a check digit.
    let odd = "";
    for (const last of "0123456789") {
      for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
        const candidate = `NL9${letter}ABNA041716430${last}`;
        let rest = 0;
        for (const char of `${candidate.slice(4)}${candidate.slice(0, 4)}`) {
          for (const digit of /\d/.test(char) ? char : String(char.charCodeAt(0) - 55))
            rest = (rest * 10 + Number(digit)) % 97;
        }
        if (rest === 1) odd = candidate;
      }
    }
    expect(odd).not.toBe("");
    expect(ibansOf(odd)).toEqual([]);
    // A letter of another script is a break: the stream "NL..ABNA0417?64300" is valid by the value of the break.
    const withBreak = withCheckDigits("NL00ABNA0417?64300");
    expect(ibansOf(withBreak)).toEqual([]);
    expect(ibansOf(withBreak.replace("?", "ł"))).toEqual([]);
    expect(failuresOf(say(withBreak.replace("?", "ł")))).toEqual([]);
  });

  test("an IBAN is found in the plain view and in the decoded view", () => {
    expect(ibansOf("NL&#91ABNA0417164300")).toEqual(["NL91ABNA0417164300"]);
    expect(ibansOf("NL%39%31ABNA0417164300")).toEqual(["NL91ABNA0417164300"]);
  });

  test("tags with attributes and closing tags are cut away; a letter group of 5 or more letters is a word", () => {
    expect(ibansOf('NL91<a href="x">ABNA</a>0417164300')).toEqual(["NL91ABNA0417164300"]);
    expect(ibansOf("NL91<b>ABNA</b>0417164300")).toEqual(["NL91ABNA0417164300"]);
    expect(ibansOf("NL91<span>ABNA0417164300")).toEqual(["NL91ABNA0417164300"]);
    // A group of 5 letters breaks the stream (a limit that keeps prose out); a group of 4 letters does not.
    const five = withCheckDigits("MT00ABCDEFGHIJ12345KLMNOPQRSTUV");
    expect(five.length).toBe(31);
    const grouped = (size: number): string => five.match(new RegExp(`.{1,${size}}`, "g"))?.join(" ") ?? "";
    expect(ibansOf(grouped(5))).toEqual([]);
    expect(ibansOf(grouped(4))).toEqual([five]);
  });

  test("a mark, a filler and a lookalike letter do not break the stream", () => {
    expect(ibansOf("NL91ABNA0417ㅤ164300")).toEqual(["NL91ABNA0417164300"]);
    const letters = withCheckDigits("NL00COPE0417164300");
    expect(ibansOf(letters.replace("COPE", "СОРЕ"))).toEqual([letters]);
    expect(ibansOf(letters.replace("COPE", "ΣΟΡΕ"))).toEqual([]);
    expect(ibansOf("NL91 ABNA 0417 ł 1643 00")).toEqual([]);
  });

  test("a word glued before a country code keeps the code: only its last two letters", () => {
    expect(ibansOf("plnNL91ABNA0417164300")).toEqual(["NL91ABNA0417164300"]);
    expect(ibansOf("złotychNL 91 ABNA 0417 1643 00")).toEqual(["NL91ABNA0417164300"]);
    expect(ibansOf("pln NL / 91 / ABNA / 0417 / 1643 / 00")).toEqual(["NL91ABNA0417164300"]);
  });

  test("a typed IBAN is allowed in the body, in any form; the same IBAN with its country letters in the mail is not", () => {
    expect(failuresOf(say("konto NL 91 ABNA 0417 1643 00"), ["Konto NL91ABNA0417164300"])).toEqual([]);
    expect(failuresOf(say("konto NL 91 ABNA 0417 1643 00"), [], ["Konto NL91ABNA0417164300"])).toEqual([
      "account_number",
    ]);
    expect(failuresOf(say("konto NL 91 ABNA 0417 1643 00"))).toEqual(["account_number"]);
  });
});

describe("pins: the folds of the views", () => {
  test("a filler that is no mark (U+3164, U+FFA0, U+115F) is removed", () => {
    for (const filler of ["ㅤ", "ﾠ", "ᅟ", "ᅠ"]) {
      expect({ filler, found: ibansOf(`NL91ABNA0417${filler}164300`) }).toEqual({
        filler,
        found: ["NL91ABNA0417164300"],
      });
    }
  });
});

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
