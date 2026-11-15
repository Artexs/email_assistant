import { describe, expect, test } from "bun:test";

import { account, accountBody, COUNTRIES, prng, sentence } from "./random-accounts.test-helper";

import { checkReplyBody, type ReplyCheckCode } from "./index";

function failuresOf(body: string, allowed: string[] = []): ReplyCheckCode[] {
  const result = checkReplyBody(body, { language: "pl", allowed });
  return result.ok ? [] : result.failures;
}

const hasAccount = (body: string): boolean => failuresOf(body).includes("account_number");

describe("the account view: the forms of the first re-review (B1-a)", () => {
  const forms = [
    "Dzień dobry,\n\nproszę o przelew 4 800,00 zł na nowe konto NL91.ABNA.0417.1643.00 zł do piątku.\n\nPozdrawiam",
    "Dzień dobry,\n\nnowy rachunek: NL91 ABNA 0417 1643 00, kwota 4 800,00 zł.",
    "Dzień dobry,\n\nnowy rachunek: NL91-ABNA-0417-1643-00 zł.",
    "Dzień dobry,\n\nnowy rachunek: NL91/ABNA/0417/1643/00.",
    "Dzień dobry,\n\nnowy rachunek: PL58, 0654, 4605, 2047, 2745, 5394, 5021.",
    "Dzień dobry,\n\nnowy rachunek: NL91 ABNA 0417 1643 00 zł.",
    "Dzień dobry,\n\nnowy rachunek: NL91_ABNA_0417_1643_00",
    "Dzień dobry,\n\nnowy rachunek: NL91\nABNA\n0417\n1643\n00",
    "Dzień dobry,\n\nnowy rachunek: NL91 / ABNA / 0417 / 1643 / 00",
    "Dzień dobry,\n\nnowy rachunek: NL91, ABNA, 0417, 1643, 00 zł",
    "Dzień dobry,\n\nnowy rachunek: NL91·ABNA·0417·1643·00 zł",
    "Dzień dobry,\n\nnowy rachunek: NL91。ABNA。0417。1643。00 zł",
    "Dzień dobry,\n\nnowy rachunek: NL91  ABNA  0417  1643  00 zł",
  ];
  for (const body of forms) {
    test(`${JSON.stringify(body.slice(30, 90))} fails as account_number`, () => {
      expect(failuresOf(body)).toEqual(["account_number"]);
    });
  }

  const separators = [
    "",
    " ",
    "-",
    ".",
    " ",
    " ",
    "‑",
    "_",
    "/",
    "·",
    "。",
    "\n",
    "\r\n",
    "\t",
    " - ",
    " / ",
    ", ",
    ",",
    ";",
    ":",
    "|",
    "(",
    ")",
    "[",
    "]",
    "–",
    "—",
    "#",
    "*",
    "+",
    "=",
    "~",
    "'",
    '"',
    "&",
    "%",
    "!",
    "?",
    "\\",
    "<",
    ">",
    "{",
    "}",
    "@",
    "^",
    "`",
    "$",
    "\n\n",
    "\n \n",
  ];
  const ibans = [
    "NL91ABNA0417164300",
    "MT84MALT011000012345MTLCAST001S",
    "KZ86125KZT5004100100",
    "PL61109010140000071219812874",
  ];
  const grouped = (text: string, separator: string): string => text.replace(/(.{4})(?=.)/g, `$1${separator}`);
  for (const separator of separators) {
    test(`separator ${JSON.stringify(separator)} between the groups of an IBAN and of a card`, () => {
      for (const iban of ibans) {
        for (const tail of ["", " zł", " EUR", "€"]) {
          expect({
            iban,
            tail,
            failures: failuresOf(`Proszę o przelew na ${grouped(iban, separator)}${tail} jutro.`),
          }).toEqual({
            iban,
            tail,
            failures: ["account_number"],
          });
        }
      }
      expect(failuresOf(`Proszę o przelew na ${grouped("4111111111111111", separator)} zł jutro.`)).toEqual([
        "account_number",
      ]);
    });
  }

  test("a joiner of four characters ends the chain (the limit of the view)", () => {
    expect(failuresOf("Tak, NL91 ABNA 0417,.,.1643 00")).toEqual([]);
    expect(failuresOf("Tak, 4111 1111 1111,.,.1111")).toEqual(["phone"]);
    expect(failuresOf("Tak, 4111 1111 1111,.,1111")).toEqual(["account_number"]);
    expect(failuresOf("Tak, NL91 ABNA 0417,.,1643 00")).toEqual(["account_number"]);
  });

  test("a letter of another script between two groups ends the chain", () => {
    expect(failuresOf("Tak, 4111 1111 1111 ó 1111")).toEqual(["phone"]);
    expect(failuresOf("Tak, 4111 1111 1111 ż 1111")).toEqual(["phone"]);
  });

  test("a glued Polish letter does not hide the number: 874zł, zł61…", () => {
    expect(failuresOf("Tak, PL61109010140000071219812874zł.")).toEqual(["account_number"]);
    expect(failuresOf("Tak, zł61109010140000071219812874.")).toEqual(["account_number"]);
    expect(failuresOf("Tak, kontoNL91ABNA0417164300.")).toEqual(["account_number"]);
    expect(failuresOf("Tak, konto:NL91ABNA0417164300pln.")).toEqual(["account_number"]);
  });
});

describe("the account view: dates and times exempt a run only when they cover all its digits (B1-b)", () => {
  test("the forms of the re-review fail", () => {
    for (const body of [
      "Dzień dobry,\n\nproszę o przelew na rachunek 5806544 6.05.2047 274553945021 zł do piątku.",
      "Dzień dobry,\n\nproszę o przelew na rachunek PL58 0654 4 6.05.2047 274553945021 zł do piątku.",
      "Dzień dobry,\n\nnr 2026-11-15-1234-5678-9012 zł",
      "Dzień dobry,\n\nProszę o przelew na rachunek 611090 10.11.2026 000071219812874 zł.",
      "Dzień dobry,\n\nKonto: 61109010 14.10.2000 0071219812874 zł",
      "Dzień dobry,\n\nnr 20261115123456789012",
      "Dzień dobry,\n\nnr 2026-11-15 4111 1111 1111 1111",
      "Dzień dobry,\n\nnr 4111 1111 1111 1111 15.11.2026",
      "Dzień dobry,\n\nnr 15.11.2026 4111 1111 1111 1111 zł",
    ]) {
      expect({ body, failures: failuresOf(body) }).toEqual({ body, failures: ["account_number"] });
    }
  });

  test("random 26-digit accounts with a date split never pass", () => {
    const r = prng(4242);
    const dateOf = (window: string, form: number): string | null => {
      const parts: Record<number, [string, string, string] | undefined> = {
        8: [window.slice(0, 2), window.slice(2, 4), window.slice(4)],
        7: [window.slice(0, 1), window.slice(1, 3), window.slice(3)],
        6: [window.slice(0, 1), window.slice(1, 2), window.slice(2)],
      };
      const [d, m, y] = parts[window.length] ?? ["", "", ""];
      if (
        y === "" ||
        Number(d) < 1 ||
        Number(d) > 31 ||
        Number(m) < 1 ||
        Number(m) > 12 ||
        Number(y) < 1900 ||
        Number(y) > 2199
      )
        return null;
      return form === 0 ? `${d}.${m}.${y}` : form === 1 ? `${d}-${m}-${y}` : `${d}/${m}/${y}`;
    };
    let tried = 0;
    let dated = 0;
    for (let i = 0; i < 400; i += 1) {
      const raw = account(r, "PL").slice(2);
      for (let at = 1; at < 20; at += 1) {
        for (const length of [6, 7, 8]) {
          const date = dateOf(raw.slice(at, at + length), at % 3);
          if (date === null) continue;
          dated += 1;
          for (const tail of [" zł", ""]) {
            tried += 1;
            const body = `Proszę o przelew na rachunek ${raw.slice(0, at)} ${date} ${raw.slice(at + length)}${tail} do piątku.`;
            expect({ body, failures: failuresOf(body) }).toEqual({ body, failures: ["account_number"] });
          }
        }
      }
    }
    expect(dated).toBeGreaterThan(100);
    expect(tried).toBe(dated * 2);
  });

  test("a date range, a list of dates and times are no account number", () => {
    for (const text of [
      "Od 15.11.2026 do 30.11.2026",
      "15.11.2026-30.11.2026",
      "15.11.2026 - 30.11.2026",
      "15/11/2026 - 30/11/2026",
      "15-11-2026 - 30-11-2026",
      "2026-11-15 - 2026-11-30",
      "2026.11.15 - 2026.11.30",
      "2026/11/15 - 2026/11/30",
      "1.1.2026 - 31.12.2026",
      "18.11.2026\n19.11.2026\n20.11.2026",
      "18.11.2026 19.11.2026 20.11.2026",
      "18.11.2026 10:00 - 20.11.2026 12:00",
      "9:00-17:00",
      "W dniach 18.11.2026, 19.11.2026",
    ]) {
      expect({ text, failures: failuresOf(`Dzień dobry, tak, ${text} dziękuję.`) }).toEqual({ text, failures: [] });
    }
  });

  test("a date with one digit of another number is a run that the dates do not cover", () => {
    expect(failuresOf("Tak, 18.11.2026 12345")).toEqual(["account_number"]);
    expect(failuresOf("Tak, 15.11.2026-30.11.20267")).toEqual(["account_number"]);
    expect(failuresOf("Tak, 15.11.2026-30.13.2026")).toEqual(["account_number"]);
    expect(failuresOf("Tak, 15.11.2026-32.11.2026")).toEqual(["account_number"]);
    expect(failuresOf("Tak, 15.11.2026-30.11.2200")).toEqual(["account_number"]);
    expect(failuresOf("Tak, 18.11.2026 25:61 18.11.2026")).toEqual(["account_number"]);
  });

  test("the limits of a time: hours to 23, minutes to 59", () => {
    expect(failuresOf("Tak, 18.11.2026 23:59 20.11.2026")).toEqual([]);
    expect(failuresOf("Tak, 18.11.2026 24:00 20.11.2026")).toEqual(["account_number"]);
    expect(failuresOf("Tak, 18.11.2026 12:60 20.11.2026")).toEqual(["account_number"]);
    expect(failuresOf("Tak, 18.11.2026 00:00 20.11.2026")).toEqual([]);
  });
});

describe("the account view: the false-positive cases (ordinary Polish text)", () => {
  const pass = [
    "Cena to 1 250,00 zł netto.",
    "Koszt wynosi 12 500 zł brutto.",
    "Łącznie 1.250.000,00 PLN.",
    "Faktura na 999,99 zł.",
    "Kwota 3500 zł do zapłaty.",
    "Rabat 15% przy zamówieniu powyżej 10 000 zł.",
    "Cena 49,90 EUR.",
    "Około 2 mln zł.",
    "Termin to 18.11.2026 o 10:00.",
    "Spotkanie 2026-11-18 o 14:30.",
    "Od 15.11.2026 do 30.11.2026.",
    "Między 15.11.2026-30.11.2026.",
    "Dostawa 18/11/2026.",
    "Do 31.12.2026 r.",
    "Termin dostawy: do 31.12.2026, ilość: 25 sztuk.",
    "W dniach 15-18.11.2026.",
    "W dniach 15-18.11.2026 w sali 12 o 10:00, koszt 250 EUR do 18.11.2026.",
    "Zamówienie nr 123456 jest w drodze.",
    "Zamówienie nr 2026/11/000123 wysłane.",
    "Faktura FV/2026/11/0042 w załączniku.",
    "Wersja 2.4.1 jest gotowa.",
    "Pokój 12, piętro 3.",
    "Wysłałem 3 sztuki po 250 zł.",
    "Mamy 15 000 sztuk na stanie.",
    "Nakład 1 200 000 egzemplarzy.",
    "Nakład 890 597 egzemplarzy w cenie 608914,50 zł brutto.",
    "Budżet 1 500 000 zł na rok 2027.",
    "Godziny 9:00-17:00.",
    "Ref. 2026-11-15/0001.",
    "Mam do 15 sztuk po 250 EUR.",
    "Na 12 345 678 90 zł.",
    "Wszystko jest 18.11.2026 o 10:00.",
  ];
  for (const text of pass) {
    test(`${JSON.stringify(text)} passes`, () => {
      expect(failuresOf(`Dzień dobry, dziękuję za wiadomość. ${text} Pozdrawiam, dziękuję bardzo.`)).toEqual([]);
    });
  }

  test("an identifier of 9 to 12 digits is a phone, one of 13 digits or more an account number (the stage rule)", () => {
    expect(failuresOf("Numer zamówienia: 10023456789 dziękuję bardzo.")).toEqual(["phone"]);
    expect(failuresOf("NIP firmy to 123-456-78-90 dziękuję bardzo.")).toEqual(["phone"]);
    expect(failuresOf("Przesyłka 600123456789012345678901 jest w paczkomacie, dziękuję bardzo.")).toEqual([
      "account_number",
    ]);
  });

  test("a typed account number stays allowed, also with a group after it", () => {
    const typed = "PL61 1090 1014 0000 0712 1981 2874";
    expect(failuresOf(`Dzień dobry, tak, konto ${typed}, 15 zł dziękuję.`, [`Konto: ${typed}`])).toEqual([]);
    expect(
      failuresOf("Dzień dobry, tak, konto 61 1090 1014 0000 0712 1981 2874 zł dziękuję.", [`Konto: ${typed}`])
    ).toEqual([]);
    expect(
      failuresOf("Dzień dobry, tak, konto PL61 1090 1014 0000 0712 1981 2875 dziękuję.", [`Konto: ${typed}`])
    ).toEqual(["account_number"]);
    // Digits before a typed number do not make it typed.
    expect(
      failuresOf("Dzień dobry, tak, konto 9 61 1090 1014 0000 0712 1981 2874 dziękuję.", [`Konto: ${typed}`])
    ).toEqual(["account_number"]);
    expect(
      failuresOf("Dzień dobry, tak, konto 61 1090 1014 0000 0712 1981 287 dziękuję.", [`Konto: ${typed}`])
    ).toEqual(["account_number"]);
  });
});

describe("the IBAN start", () => {
  test("a country code that is a group of its own, or glued to its check digits", () => {
    expect(failuresOf("Tak, NL 91 ABNA 0417 1643 00")).toEqual(["account_number"]);
    expect(failuresOf("Tak, N L91 ABNA 0417 1643 00")).toEqual(["account_number"]);
    expect(failuresOf("Tak, nl 91 abna 0417 1643 00")).toEqual(["account_number"]);
    expect(failuresOf("Tak, nl91abna0417164300")).toEqual(["account_number"]);
    expect(failuresOf("Tak, Nl91Abna0417164300")).toEqual(["account_number"]);
  });

  test("an ordinary word that is a country code is no start; the same code in capitals is", () => {
    expect(failuresOf("Tak, do 31 12 2026 w ilości 25 szt. po 20 EUR")).toEqual([]);
    for (const word of ["do", "no", "it", "is", "be", "at", "me", "so", "by", "mu", "ye"]) {
      expect({ word, failures: failuresOf(`Tak, ${word} 12 ABNA 0417 1643`) }).toEqual({ word, failures: [] });
    }
    expect(failuresOf("Tak, DO 12 ABNA 0417 1643")).toEqual(["account_number"]);
  });

  test("a word that ends with a country code and a group of digits is no start", () => {
    expect(failuresOf("Tak, w dniach 15-18.11.2026 abc")).toEqual([]);
    expect(failuresOf("Tak, w sali 12 o 10:00, koszt 250 EUR do 18.11.2026.")).toEqual([]);
    expect(failuresOf("Tak, Nakład 890 597 egzemplarzy w cenie 608914,50 zł.")).toEqual([]);
  });

  test("a code that is no country code is no IBAN", () => {
    for (const code of ["XX", "FV", "AA", "ZZ", "QQ", "WW"]) {
      expect({ code, failures: failuresOf(`Tak, ${code}12ABCD04171643`) }).toEqual({ code, failures: [] });
    }
  });

  test("each country code of the registry starts an IBAN", () => {
    const codes =
      "AD AE AL AT AZ BA BE BG BH BI BR BY CH CR CY CZ DE DJ DK DO EE EG ES FI FK FO FR GB GE GI GL GR GT HR HU IE IL IQ IS IT JO KW KZ LB LC LI LT LU LV LY MC MD ME MK MN MR MT MU NI NL NO OM PK PL PS PT QA RO RS RU SA SC SD SE SI SK SM SO ST SV TL TN TR UA VA VG XK YE".split(
        " "
      );
    expect(codes).toHaveLength(88);
    for (const code of codes) {
      expect({ code, failures: failuresOf(`Tak, ${code}12ABCD04171643`) }).toEqual({
        code,
        failures: ["account_number"],
      });
    }
  });

  test("a key is up to 34 characters; 15 characters and 10 digits are the least", () => {
    expect(failuresOf("Tak, NL12ABC12345678.")).toEqual(["account_number"]);
    expect(failuresOf("Tak, NL12ABC1234567.")).toEqual([]);
    expect(failuresOf("Tak, NL12ABCD123456")).toEqual([]);
    expect(failuresOf("Tak, NL12ABCDE12345678")).toEqual(["account_number"]);
  });
});

describe("random accounts and ordinary sentences (seeded)", () => {
  for (const country of COUNTRIES) {
    test(`300 random ${country} accounts, random separators, currencies and date-like splits: no miss`, () => {
      const r = prng(1000 + country.charCodeAt(0) * 31 + country.charCodeAt(1));
      const misses: string[] = [];
      for (let i = 0; i < 300; i += 1) {
        const { body, raw } = accountBody(r, country);
        if (!hasAccount(body)) misses.push(JSON.stringify({ raw, body }));
      }
      expect(misses).toEqual([]);
    });
  }

  test("1,000 ordinary Polish business sentences pass", () => {
    const r = prng(777);
    const bad: string[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const text = sentence(r);
      const failures = failuresOf(text);
      if (failures.length > 0) bad.push(`${failures.join(",")} ${JSON.stringify(text)}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("pins of the account view (mutation survivors)", () => {
  test("the window of an IBAN: 15 to 34 characters, 10 digits", () => {
    // 14 characters: too short. 15 characters and 10 digits: an IBAN.
    expect(failuresOf("Tak, NL12AB12345678.")).toEqual([]);
    expect(failuresOf("Tak, NL12ABC12345678.")).toEqual(["account_number"]);
    // 34 characters with the 10th digit last: an IBAN. 35 characters: the 10th digit is out of the window.
    expect(failuresOf(`Tak, NL12${"A".repeat(22)}12345678.`)).toEqual(["account_number"]);
    expect(failuresOf(`Tak, NL12${"A".repeat(23)}12345678.`)).toEqual([]);
    // 9 digits in 15 characters: no. 10 digits in 16: yes.
    expect(failuresOf("Tak, NL12ABCD1234567.")).toEqual([]);
    expect(failuresOf("Tak, NL12ABCD12345678.")).toEqual(["account_number"]);
    // The check digits are two digits.
    expect(failuresOf("Tak, NL1A2B3CD12345678.")).toEqual([]);
  });

  test("a word that ends with a country code and a digit, then a group of digits, is no start", () => {
    expect(failuresOf("Tak, w dniach1 5 18 11 2026 abc")).toEqual(["phone"]);
    expect(failuresOf("Tak, w dniach15 18 11 2026 abc")).toContain("account_number");
  });

  test("a number sign, a fraction or an emoji between two groups", () => {
    // A character that is a number (U+2180, a Roman numeral) is no joiner; an emoji is one character, three of them make a joiner.
    expect(failuresOf("Tak, 4111 1111 1111\u21801111")).toEqual(["phone"]);
    expect(failuresOf("Tak, 4111 1111 1111😀😀😀1111")).toEqual(["account_number"]);
    expect(failuresOf("Tak, 4111 1111 1111😀😀😀😀1111")).toEqual(["phone"]);
  });

  test("a typed IBAN with a currency after it is the same IBAN with another currency after it", () => {
    expect(failuresOf("Tak, NL91 ABNA 0417 1643 00 EUR dziękuję.", ["Konto NL91 ABNA 0417 1643 00 PLN"])).toEqual([]);
    expect(failuresOf("Tak, NL91 ABNA 0417 1643 01 EUR dziękuję.", ["Konto NL91 ABNA 0417 1643 00 PLN"])).toEqual([
      "account_number",
    ]);
  });

  test("a date range with one more digit at its start or end is no exempt run", () => {
    expect(failuresOf("Tak, 7 15.11.2026 - 30.11.2026")).toEqual(["account_number"]);
    expect(failuresOf("Tak, 15.11.2026 - 30.11.2026 7")).toEqual(["account_number"]);
    expect(failuresOf("Tak, 2026-13-01 2026-12-01")).toEqual(["account_number"]);
    expect(failuresOf("Tak, 2026-12-01 2026-12-32")).toEqual(["account_number"]);
  });

  test("two account numbers in one text: both are cut, nothing is left", () => {
    expect(failuresOf("Tak, 4111 1111 1111 1111 oraz 5500 0000 0000 0004 dziękuję.")).toEqual(["account_number"]);
    expect(failuresOf("Tak, 4111 1111 1111 1111 oraz NL91 ABNA 0417 1643 00 oraz 5500 0000 0000 0004.")).toEqual([
      "account_number",
    ]);
  });

  test("the cut covers the whole number: no digit of it is left for the phone count", () => {
    expect(failuresOf("Tak, 4111 1111 1111 1111    600 100 20")).toEqual(["account_number"]);
    expect(failuresOf("Tak, 600 100 20    4111 1111 1111 1111")).toEqual(["account_number"]);
  });

  test("a cut leaves a break: a phone number does not join across a cut amount", () => {
    expect(failuresOf("Tak, 12345 1,5 zł 67890")).toEqual([]);
  });

  test("a phone number may hold brackets and parentheses", () => {
    expect(failuresOf("Tak, 600 (100) 200")).toEqual(["phone"]);
    expect(failuresOf("Tak, 600 [100] 200")).toEqual(["phone"]);
    expect(failuresOf("Tak, (600) 100 200")).toEqual(["phone"]);
  });

  test("a time is a time only with its digits alone", () => {
    expect(failuresOf("Tak, 11:223 4567 890")).toEqual(["phone"]);
    expect(failuresOf("Tak, 111:22 4567 890")).toEqual(["phone"]);
    expect(failuresOf("Tak, 11:22 4567 8901")).toEqual([]);
  });

  test("an amount keeps its digits together: a 12-digit amount with decimals and groups", () => {
    for (const amount of [
      "12 345 678 901,5",
      "12.345.678.901,5",
      "12 345 678 901.5",
      "12345678901,5",
      "1234567890,50",
      "123.456.789.012",
      "123 456 789 012",
    ]) {
      for (const text of [`Tak, ${amount} zł dziękuję`, `Tak, zł ${amount} dziękuję`, `Tak, € ${amount} dziękuję`]) {
        expect({ text, failures: failuresOf(text) }).toEqual({ text, failures: [] });
      }
    }
    expect(failuresOf("Tak, 123456789,50")).toEqual(["phone"]);
    expect(failuresOf("Tak, 123456789,500 zł")).toEqual(["phone"]);
  });

  test("a typed account number allows no other kind of entity whose key starts with its digits", () => {
    expect(failuresOf("Tak, 4111111111111.com dziękuję", ["Karta 4111111111111"])).toEqual(["link"]);
    expect(failuresOf("Tak, karta 4111111111111 dziękuję", ["Karta 4111111111111"])).toEqual([]);
  });

  test("a group that follows a number sign is a group start; the Roman numeral is no letter", () => {
    expect(failuresOf("Tak, \u2180NL 91 ABNA 0417 1643 dziękuję")).toEqual(["account_number"]);
  });

  test("a typed card does not allow a phone number that starts with its digits", () => {
    expect(failuresOf("Tak, tel 411111111 dziękuję", ["Karta 4111 1111 1111 1111"])).toEqual(["phone"]);
    expect(failuresOf("Tak, karta 4111 1111 1111 1111 dziękuję", ["Karta 4111 1111 1111 1111"])).toEqual([]);
  });
});
