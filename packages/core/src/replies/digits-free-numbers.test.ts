import { describe, expect, test } from "bun:test";

import { failuresOf, say } from "./digits.test-helper";
import { account, accountBody, COUNTRIES, prng, sentence, withCheckDigits } from "./random-accounts.test-helper";

import { IBAN_LENGTHS, ibansOf } from "./index";

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
