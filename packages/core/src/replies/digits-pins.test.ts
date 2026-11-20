import { describe, expect, test } from "bun:test";

import { failuresOf, say } from "./digits.test-helper";
import { withCheckDigits } from "./random-accounts.test-helper";

import { IBAN_LENGTHS, ibansOf, type ReplyCheckCode } from "./index";

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
