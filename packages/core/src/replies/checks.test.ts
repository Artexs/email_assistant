import { describe, expect, test } from "bun:test";

import { ENGLISH_WORDS, POLISH_WORDS } from "./language";

import {
  checkReplyBody,
  DRAFT_MAX_CHARS,
  gapsOf,
  hasGaps,
  normalizeDraftText,
  type ReplyCheckCode,
  REPLY_CHECK_CODES,
} from "./index";

type Lang = "pl" | "en";

function failuresOf(body: string, language: Lang = "pl", allowed: string[] = []): ReplyCheckCode[] {
  const result = checkReplyBody(body, { language, allowed });
  return result.ok ? [] : result.failures;
}

const GREETING = "Dzień dobry,\n\nTak, wtorek mi pasuje.\n";

describe("checkReplyBody: the cases of the stage", () => {
  test("1. a short Polish reply passes", () => {
    expect(checkReplyBody(GREETING, { language: "pl", allowed: [] })).toEqual({ ok: true });
  });

  test("2. an address fails unless the user typed it", () => {
    expect(failuresOf("Dzień dobry, napisz do jan@firma.pl, tak.")).toEqual(["address"]);
    expect(failuresOf("Dzień dobry, napisz do jan@firma.pl, tak.", "pl", ["jan@firma.pl"])).toEqual([]);
    // The match ignores case and the white space around the typed text.
    expect(failuresOf("Dzień dobry, napisz do JAN@Firma.pl, tak.", "pl", ["Mój adres:   jan@firma.pl"])).toEqual([]);
    // Another address in the same text still fails.
    expect(failuresOf("Dzień dobry, jan@firma.pl i ewa@firma.pl, tak.", "pl", ["jan@firma.pl"])).toEqual(["address"]);
    // A longer typed address is not the shorter one.
    expect(failuresOf("Dzień dobry, jan@firma.pl, tak.", "pl", ["xjan@firma.pl"])).toEqual(["address"]);
  });

  test("3. a link fails", () => {
    expect(failuresOf("Dzień dobry, zobacz https://x.example/a, tak.")).toEqual(["link"]);
    expect(failuresOf("Dzień dobry, zobacz www.x.example, tak.")).toEqual(["link"]);
    expect(failuresOf("Dzień dobry, zobacz https://x.example/a, tak.", "pl", ["https://x.example/a"])).toEqual([]);
  });

  test("4. a phone number and an account number fail, each with its own code", () => {
    expect(failuresOf("Dzień dobry, dzwoń +48 600 100 200, tak.")).toEqual(["phone"]);
    expect(failuresOf("Dzień dobry, konto PL61 1090 1014 0000 0712 1981 2874, tak.")).toEqual(["account_number"]);
    expect(failuresOf("Dzień dobry, karta 4111 1111 1111 1111, tak.")).toEqual(["account_number"]);
    expect(failuresOf("Dzień dobry, dzwoń +48 600 100 200, tak.", "pl", ["tel. 600-100-200"])).toEqual(["phone"]);
    expect(failuresOf("Dzień dobry, dzwoń 600-100-200, tak.", "pl", ["tel. 600 100 200"])).toEqual([]);
  });

  test("5. three blank lines fail, two pass", () => {
    expect(failuresOf("Dzień dobry,\n\n\n\nTak, wtorek.")).toEqual(["blank_lines"]);
    expect(failuresOf("Dzień dobry,\n\n\nTak, wtorek.")).toEqual([]);
  });

  test("6. a header-like line fails", () => {
    expect(failuresOf("Dzień dobry,\nSubject: x\nTak.")).toEqual(["header_line"]);
    expect(failuresOf("Dzień dobry,\nTemat: x\nTak.")).toEqual(["header_line"]);
    // A name that is no header name passes.
    expect(failuresOf("Dzień dobry,\nUwaga: x\nTak.")).toEqual([]);
  });

  test("7. a bidi or control character fails", () => {
    expect(failuresOf("Dzień dobry, tak\u202e.")).toEqual(["control_chars"]);
    expect(failuresOf("Dzień dobry, tak\u0007.")).toEqual(["control_chars"]);
  });

  test("8. 2,001 characters fail, 2,000 pass", () => {
    const words = "tak nie jest ";
    const make = (length: number) => words.repeat(Math.ceil(length / words.length)).slice(0, length);
    expect(failuresOf(make(DRAFT_MAX_CHARS + 1))).toEqual(["too_long"]);
    expect(failuresOf(make(DRAFT_MAX_CHARS))).toEqual([]);
  });

  test("9. an English body under language pl fails; the same body under en passes", () => {
    const english =
      "Hello, thanks for your message. We will have the answer for you by the end of this week, and I will send it if the team is ready. Please wait for it.";
    expect(english.length).toBeGreaterThan(80);
    expect(failuresOf(english, "pl")).toEqual(["language"]);
    expect(failuresOf(english, "en")).toEqual([]);
  });

  test("9b. a text with no common word passes under 80 characters only", () => {
    expect(failuresOf("Wtorek 18, 10:30, sala 4B.")).toEqual([]);
    expect(
      failuresOf("Wtorek, szesnasty, dziesiąta trzydzieści, sala czwarta, budynek główny, piętro drugie.")
    ).toEqual(["language"]);
  });

  test("10. gaps", () => {
    const body = "Dzień dobry, [[yes or no for Tuesday]]";
    expect(checkReplyBody(body, { language: "pl", allowed: [] })).toEqual({ ok: true });
    expect(gapsOf(body)).toEqual(["yes or no for Tuesday"]);
    expect(failuresOf("Dzień dobry, [[]]")).toEqual(["gap_syntax"]);
    expect(failuresOf("Dzień dobry, [[a [b]]")).toEqual(["gap_syntax"]);
    expect(failuresOf("Dzień dobry, [[ ]]")).toEqual(["gap_syntax"]);
    expect(failuresOf("Dzień dobry, [[a]] i ]] tak")).toEqual(["gap_syntax"]);
    expect(failuresOf(`Dzień dobry, [[${"a".repeat(81)}]]`)).toEqual(["gap_syntax"]);
    expect(failuresOf(`Dzień dobry, [[${"a".repeat(80)}]]`)).toEqual([]);
    expect(hasGaps("a [[b")).toBe(true);
    expect(hasGaps("a [b]")).toBe(false);
    // A gap label is text of the model: it passes the same checks.
    expect(failuresOf("Dzień dobry, [[napisz do jan@firma.pl]] tak")).toEqual(["address"]);
  });

  test("11. normalizeDraftText", () => {
    expect(normalizeDraftText("a \r\nb\r\n\r\n")).toBe("a\nb");
    expect(normalizeDraftText("a\rb  \n\t\n")).toBe("a\nb");
  });

  test("12. a date, a time and an amount are no phone number", () => {
    for (const text of [
      "18.11.2026 10:00",
      "2026-11-18",
      "1 250 000,00 zł",
      "$12,500.00",
      "18-11-2026",
      "12 500 000 PLN",
    ]) {
      expect(failuresOf(`Dzień dobry, tak: ${text}.`)).toEqual([]);
    }
  });
});

describe("checkReplyBody: quoted, encoded and lookalike forms", () => {
  const cases: [string, string, ReplyCheckCode][] = [
    ["quoted address", 'Tak, napisz na "jan@firma.pl".', "address"],
    ["angle address", "Tak, napisz na <jan@firma.pl>.", "address"],
    ["mailto", "Tak, mailto:jan@firma.pl", "address"],
    ["fullwidth at", "Tak, napisz na jan＠firma.pl", "address"],
    ["small at", "Tak, napisz na jan﹫firma.pl", "address"],
    ["zero-width inside", "Tak, napisz na jan@fi\u200brma.pl", "address"],
    ["percent at", "Tak, napisz na jan%40firma.pl", "address"],
    ["double percent at", "Tak, napisz na jan%2540firma.pl", "address"],
    ["entity at", "Tak, napisz na jan&#64;firma.pl", "address"],
    ["hex entity at", "Tak, napisz na jan&#x40;firma.pl", "address"],
    ["named entity at", "Tak, napisz na jan&commat;firma.pl", "address"],
    ["unicode escape at", "Tak, napisz na jan\\u0040firma.pl", "address"],
    ["bracket at", "Tak, napisz na jan[at]firma[dot]pl", "address"],
    ["paren at", "Tak, napisz na jan (at) firma (dot) pl", "address"],
    ["Polish word at", "Tak, napisz na jan [małpa] firma [kropka] pl", "address"],
    ["words at and dot", "Tak, napisz na jan at firma dot pl", "address"],
    ["fullwidth link", "Tak, ｈｔｔｐｓ：／／x.example/a", "link"],
    ["hxxp", "Tak, hxxps://x.example/a", "link"],
    ["percent scheme", "Tak, https%3A%2F%2Fx.example%2Fa", "link"],
    ["lookalike scheme letter", "Tak, һttps://x.example/a", "link"],
    ["lookalike dot", "Tak, www．x。example", "link"],
    ["bracket dot", "Tak, x[.]example/a", "link"],
    ["bare domain", "Tak, patrz firma.pl/oferta", "link"],
    ["slash lookalike", "Tak, https:∕∕x.example", "link"],
    ["javascript", "Tak, javascript:alert(1)", "link"],
    ["fullwidth digits", "Tak, ＋４８ ６００ １００ ２００", "phone"],
    ["arabic-indic digits", "Tak, ٦٠٠ ١٠٠ ٢٠٠", "phone"],
    ["dots and brackets", "Tak, (48) 600.100.200", "phone"],
    ["dashes", "Tak, 600-100-200", "phone"],
    ["en dash lookalike", "Tak, 600‑100‑200", "phone"],
    ["percent digits", "Tak, %36%30%30%31%30%30%32%30%30", "phone"],
    ["lowercase iban", "Tak, pl61 1090 1014 0000 0712 1981 2874", "account_number"],
    ["iban without spaces", "Tak, PL61109010140000071219812874", "account_number"],
    ["dashed card", "Tak, 4111-1111-1111-1111", "account_number"],
    ["26 digit account", "Tak, 61 1090 1014 0000 0712 1981 2874", "account_number"],
    ["quoted header", "Tak.\n> From: a", "header_line"],
    ["upper header", "Tak.\nSUBJECT: x", "header_line"],
    ["space before colon", "Tak.\nSubject : x", "header_line"],
    ["fullwidth header", "Tak.\nＳｕｂｊｅｃｔ： x", "header_line"],
    ["lookalike header letter", "Tak.\nSubjесt: x", "header_line"],
    ["entity header", "Tak.\nSubject&#58; x", "header_line"],
    ["reply-to header", "Tak.\nReply-To: x", "header_line"],
    ["Polish header", "Tak.\nOd: x\nDo: y", "header_line"],
    ["empty header value", "Tak.\nBcc:", "header_line"],
    ["header after CR", "Tak.\rBcc: x", "header_line"],
    ["whitespace blank lines", "Tak,\n \n\t\n \u00a0\nnie.", "blank_lines"],
    ["zero-width blank lines", "Tak,\n\u200b\n\u200b\n\u200b\nnie.", "blank_lines"],
    ["CRLF blank lines", "Tak,\r\n\r\n\r\n\r\nnie.", "blank_lines"],
    ["CR blank lines", "Tak,\r\r\r\rnie.", "blank_lines"],
    ["rlo", "Tak, \u202efdp.exe", "control_chars"],
    ["isolate", "Tak, \u2066x\u2069", "control_chars"],
    ["zero width space", "Tak, a\u200bb", "control_chars"],
    ["soft hyphen", "Tak, a\u00adb", "control_chars"],
    ["tag character", "Tak, \u{E0041}", "control_chars"],
    ["NEL", "Tak,\u0085nie", "control_chars"],
    ["line separator", "Tak,\u2028nie", "control_chars"],
    ["escape", "Tak, \u001B[31m", "control_chars"],
    ["fullwidth bracket gap", "Tak, ［［x［", "gap_syntax"],
  ];
  for (const [name, body, code] of cases) {
    test(`${name} → ${code}`, () => {
      expect(failuresOf(body)).toContain(code);
    });
  }

  test("format characters split nothing: a number, a header name and a domain are read through them", () => {
    expect(failuresOf("Tak, 600\u200b100\u200b200")).toContain("phone");
    expect(failuresOf("Tak.\nSub\u200bject: x")).toContain("header_line");
    expect(failuresOf("Tak, ww\u200bw.x.zzzz")).toContain("link");
  });

  test("a link with an unknown top-level domain still fails by its scheme or by www", () => {
    expect(failuresOf("Tak, https://x.zzzz/a")).toEqual(["link"]);
    expect(failuresOf("Tak, www.x.zzzz")).toEqual(["link"]);
  });

  test("digit counts: 8 digits pass, 9 are a phone; 12 are a phone, 13 an account number", () => {
    expect(failuresOf("Tak, 12345678")).toEqual([]);
    expect(failuresOf("Tak, 123456789")).toEqual(["phone"]);
    expect(failuresOf("Tak, 123456789012")).toEqual(["phone"]);
    expect(failuresOf("Tak, 1234567890123")).toEqual(["account_number"]);
  });

  test("an IBAN with few digits is an account number; a word run with a code is not", () => {
    expect(failuresOf("Tak, GB00 ABCD 1234 5678 90")).toEqual(["account_number"]);
    expect(failuresOf("Hello, MA12 reply tomorrow please", "en")).toEqual([]);
  });

  test("a number next to a date, a time or a currency is cut out before the digits are counted", () => {
    expect(failuresOf("Tak, 18.11.2026 600 osób")).toEqual([]);
    expect(failuresOf("Tak, 18.11.2026 12 345 osób")).toEqual([]);
    expect(failuresOf("Tak, 2026-11-18 12345 osób")).toEqual([]);
    expect(failuresOf("Tak, 10:00 12345 678 osób")).toEqual([]);
    expect(failuresOf("Tak, 1 250 000.00 zł")).toEqual([]);
    expect(failuresOf("Tak, 123 456 789 PLN")).toEqual([]);
    expect(failuresOf("Tak, PLN 123 456 789")).toEqual([]);
    expect(failuresOf("Tak, 123 456 789 osób")).toEqual(["phone"]);
  });

  test("a fullwidth gap counts as a gap", () => {
    expect(hasGaps("Tak, ［［x］］")).toBe(true);
    expect(gapsOf("Tak, ［［x］］")).toEqual(["x"]);
  });

  test("the user may type an encoded address too: the decoded address is the one that counts", () => {
    expect(failuresOf("Tak, napisz na jan%40firma.pl", "pl", ["jan@firma.pl"])).toEqual([]);
    expect(failuresOf("Tak, napisz na jan%40firma.pl", "pl", ["ewa@firma.pl"])).toEqual(["address"]);
  });

  test("plain Polish text with a date, a time, a count and a colon passes", () => {
    const body =
      "Dzień dobry,\n\nSpotkanie jest 18.11.2026 o 10:00. Mam 3 pytania: czy to jest pilne? Cena: 1 250,50 zł.\n\nPozdrawiam";
    expect(failuresOf(body)).toEqual([]);
  });

  test("failures come in the order of the code list", () => {
    const body = "Dzień dobry, jan@firma.pl https://x.example \u0007 +48 600 100 200";
    const failures = failuresOf(body);
    expect(failures).toEqual(REPLY_CHECK_CODES.filter((code) => failures.includes(code)));
    expect(failures).toEqual(["address", "link", "phone", "control_chars"]);
  });
});

describe("the word lists of the language check", () => {
  test("each list has 30 distinct words and the lists share none", () => {
    expect(new Set(POLISH_WORDS).size).toBe(30);
    expect(new Set(ENGLISH_WORDS).size).toBe(30);
    expect(POLISH_WORDS.filter((word) => (ENGLISH_WORDS as readonly string[]).includes(word))).toEqual([]);
  });
});

describe("account numbers next to a currency (B1): the amount cut never hides an account", () => {
  const compact = [
    "PL61109010140000071219812874",
    "DE89370400440532013000",
    "4111111111111111",
    "61109010140000071219812874",
  ];
  const grouped = [
    "PL61 1090 1014 0000 0712 1981 2874",
    "PL61 109 010 140 000 071 219 812 874",
    "4111 1111 1111 1111",
    "4111 111 111 111 111",
    "61 1090 1014 0000 0712 1981 2874",
    "PL 61 1090 1014 0000 0712 1981 2874",
    "PL61-1090-1014-0000-0712-1981-2874",
    "PL61.1090.1014.0000.0712.1981.2874",
    "4111-1111-1111-1111",
    "(4111) (1111) (1111) (1111)",
    "[4111][1111][1111][1111]",
    "4111|1111|1111|1111",
    "4111.1111.1111.1111",
    "4111/1111/1111/1111",
    "4111_1111_1111_1111",
    "4111,1111,1111,1111",
    "4,111,111,111,111,111",
    "6110 9010\n1400 0007\n1219 8128 74",
    "3782 822463 10005",
    "20-00-00 55779911",
    "021000021/123456789012",
    "pl61 1090 1014 0000 0712 1981 2874",
    "GB29 NWBK 6016 1331 9268 19",
  ];
  const currencies = ["zł", "zl", "PLN", "pln", "EUR", "USD", "GBP", "CHF", "euro", "dolarów", "$", "€", "£"];

  for (const base of [...compact, ...grouped]) {
    test(`${JSON.stringify(base)} fails with every currency, before or after, and inside a sentence`, () => {
      const bodies = [`Dzień dobry, tak, ${base} dziękuję.`];
      for (const currency of currencies) {
        bodies.push(
          `Dzień dobry, tak, ${base} ${currency}.`,
          `Dzień dobry, tak, ${base}${currency}.`,
          `Dzień dobry, tak, ${currency} ${base}.`,
          `Dzień dobry, tak, ${currency}${base}.`,
          `Dzień dobry, proszę o przelew ${currency} na konto ${base} do piątku.`
        );
      }
      for (const body of bodies) {
        expect({ body, failures: failuresOf(body) }).toEqual({ body, failures: ["account_number"] });
      }
    });
  }

  test("an account number written with other digits or codes fails too", () => {
    const forms = [
      "Dzień dobry, tak, ６１１０９０１０１４０００００７１２１９８１２８７４ zł",
      "Dzień dobry, tak, ٦١١٠٩٠١٠١٤٠٠٠٠٠٧١٢١٩٨١٢٨٧٤ PLN",
      "Dzień dobry, tak, %36%31%31%30%39%30%31%30%31%34%30%30%30%30%30%37%31%32%31%39%38%31%32%38%37%34 USD",
      "Dzień dobry, tak, 61109010140000071219812874&#8202;zł",
    ];
    for (const body of forms) expect(failuresOf(body)).toContain("account_number");
  });

  test("a typed account number passes in its own form and fails in another", () => {
    const typed = "PL61 1090 1014 0000 0712 1981 2874";
    expect(failuresOf(`Dzień dobry, tak, konto ${typed} zł.`, "pl", [`Konto: ${typed}`])).toEqual([]);
    expect(failuresOf(`Dzień dobry, tak, konto pl61109010140000071219812874 zł.`, "pl", [`Konto: ${typed}`])).toEqual(
      []
    );
    expect(
      failuresOf(`Dzień dobry, tak, konto PL61 1090 1014 0000 0712 1981 2875 zł.`, "pl", [`Konto: ${typed}`])
    ).toEqual(["account_number"]);
    expect(failuresOf(`Dzień dobry, tak, karta 4111 1111 1111 1111 zł.`, "pl", ["karta 4111-1111-1111-1111"])).toEqual(
      []
    );
    // A word after the typed number does not change its key.
    expect(failuresOf(`Dzień dobry, tak, ${typed} dziękuję.`, "pl", [typed])).toEqual([]);
  });

  test("an amount, a date, a date range and a time stay no account number and no phone", () => {
    const ok = [
      "1 250 000,00 zł",
      "1 250 000.00 zł",
      "$12,500.00",
      "€ 1 234 567,89",
      "123 456 789 PLN",
      "PLN 123 456 789",
      "123 456 789 012 PLN",
      "$123 456 789",
      "£123 456 789",
      "123 456 789 €",
      "600 100 200 zł",
      "18.11.2026 - 20.11.2026",
      "od 18.11.2026 do 20.11.2026",
      "2026-11-18 – 2026-11-20",
      "18.11.2026\n19.11.2026\n20.11.2026",
      "10:00 - 12:00",
      "kwota 2 500,00 EUR do 18.11.2026 10:00",
      "Faktura 12/2026",
      "pokój 101, 102, 103, 104",
    ];
    for (const text of ok) {
      expect({ text, failures: failuresOf(`Dzień dobry, tak, ${text} dziękuję.`) }).toEqual({ text, failures: [] });
    }
  });

  test("a phone number next to a currency still passes only as an amount; the same digits without it fail", () => {
    expect(failuresOf("Tak, 600 100 200")).toEqual(["phone"]);
    expect(failuresOf("Tak, 600 100 200 zł")).toEqual([]);
  });
});

describe("pins of the number rules", () => {
  test("a short IBAN (15 characters) is an account number", () => {
    expect(failuresOf("Tak, NO93 8601 1117 947")).toEqual(["account_number"]);
    expect(failuresOf("Hello, XX12 ABC12345678 please", "en")).toEqual(["account_number"]);
  });

  test("a long IBAN (31 characters) is one account number, not a phone", () => {
    expect(failuresOf("Tak, MT84MALT011000012345MTLCAST001S")).toEqual(["account_number"]);
    expect(failuresOf("Tak, MT84 MALT 0110 0001 2345 MTLC AST0 01S")).toEqual(["account_number"]);
  });

  test("an IBAN needs 10 digits: 7 digits in a word run pass, 10 digits fail", () => {
    expect(failuresOf("Hello, AB12 reply 12345 tomorrow please", "en")).toEqual([]);
    expect(failuresOf("Hello, XX12 ABC12345678 please", "en")).toEqual(["account_number"]);
    expect(failuresOf("Hello, MA12 reply tomorrow please", "en")).toEqual([]);
  });

  test("an IBAN does not start inside a word", () => {
    expect(failuresOf("Hello, XABC12 34567 890ABC please", "en")).toEqual(["phone"]);
  });

  test("a date, a time and an amount are cut out for the phone count, each by its own rule", () => {
    expect(failuresOf("Tak, 1.1.2026 12345")).toEqual([]);
    expect(failuresOf("Tak, 2026-1-1 12345")).toEqual([]);
    expect(failuresOf("Tak, 10:00 12345 678")).toEqual([]);
    expect(failuresOf("Tak, 1 250 000.00")).toEqual([]);
    expect(failuresOf("Tak, $123 456 789")).toEqual([]);
    expect(failuresOf("Tak, 123 456 789 €")).toEqual([]);
    // A group of digits that is no date stays in the count.
    expect(failuresOf("Tak, 12-34-5678 123")).toEqual(["phone"]);
    // The limits of a date: day 1–31, month 1–12, year 1900–2199.
    for (const date of [
      "31-02-1800",
      "31-12-2200",
      "32-01-2026",
      "00-01-2026",
      "01-13-2026",
      "01-00-2026",
      "2200-01-01",
      "1899-12-31",
      "2026-13-01",
      "2026-01-32",
      "2026-00-01",
      "2026-01-00",
    ]) {
      expect({ date, failures: failuresOf(`Tak, ${date} 123`) }).toEqual({ date, failures: ["phone"] });
    }
    for (const date of ["31-12-2199", "01-01-1900", "1-1-2026", "2199-12-31", "1900-01-01", "2026-1-1"]) {
      expect({ date, failures: failuresOf(`Tak, ${date} 123`) }).toEqual({ date, failures: [] });
    }
  });

  test("a date range is no account number, but a long number around a date is", () => {
    expect(failuresOf("Tak, 18.11.2026 20.11.2026")).toEqual([]);
    expect(failuresOf("Tak, 61 1090 18.11.2026 1014 0000 0712 1981 2874")).toEqual(["account_number"]);
  });

  test("lookalike dots and slashes are folded before the link scan", () => {
    for (const dot of ["。", "｡", "·", "∙", "․"]) {
      expect({ dot, failures: failuresOf(`Tak, patrz firma${dot}pl`) }).toEqual({ dot, failures: ["link"] });
    }
    for (const slash of ["⁄", "∕", "⧸", "╱", "／"]) {
      expect({ slash, failures: failuresOf(`Tak, https:${slash}${slash}x.zzzz/a`) }).toEqual({
        slash,
        failures: ["link"],
      });
    }
  });

  test("escapes and decode rounds: \\x40, \\u0040 and a triple percent code read as the at sign", () => {
    expect(failuresOf(String.raw`Tak, jan\x40firma.pl`)).toContain("address");
    expect(failuresOf(String.raw`Tak, jan@firma.pl`)).toContain("address");
    expect(failuresOf("Tak, jan%252540firma.pl")).toContain("address");
    expect(failuresOf("Tak, jan%2540firma.pl")).toContain("address");
  });

  test("header names dw, data and date, in both languages", () => {
    for (const name of ["Dw", "Data", "Date", "Od", "Do", "Temat", "DW", "Bcc", "Cc", "To", "From"]) {
      expect({ name, failures: failuresOf(`Tak.\n${name}: x`) }).toEqual({ name, failures: ["header_line"] });
    }
  });

  test("a private-use character and a lone surrogate are control characters", () => {
    expect(failuresOf("Tak, \ue000")).toEqual(["control_chars"]);
    expect(failuresOf("Tak, \ud800")).toEqual(["control_chars"]);
    expect(failuresOf("Tak, \udc00x")).toEqual(["control_chars"]);
  });

  test("the language check reads the text without its gap labels", () => {
    const body = "Tak, [[the answer is not in the file and you will have it from us]]";
    expect(failuresOf(body, "pl")).toEqual([]);
    // The sentences outside the gaps still count.
    expect(failuresOf("Hello, thanks for your message. [[tak lub nie]]", "pl")).toEqual(["language"]);
  });

  test("too_long counts code points, not UTF-16 units", () => {
    const polish = "tak nie ".repeat(Math.ceil(1300 / 8)).slice(0, 1300);
    const astral = "😀".repeat(400);
    expect([...`${polish}${astral}`].length).toBe(1700);
    expect(`${polish}${astral}`.length).toBeGreaterThan(DRAFT_MAX_CHARS);
    expect(failuresOf(`${polish}${astral}`)).toEqual([]);
    expect(failuresOf(`${polish}${"😀".repeat(701)}`)).toEqual(["too_long"]);
  });
});

describe("invisible blank lines", () => {
  const invisible = [
    "\u2800",
    "\u3164",
    "\uffa0",
    "\u115f",
    "\u1160",
    "\u034f",
    "\u17b4",
    "\u17b5",
    "\ufe0f",
    "\ufffc",
    "\u180b",
    "\u2063",
    "\u200b",
    "\u00a0",
    "\u3000",
  ];
  for (const char of invisible) {
    test(`50 lines of U+${char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")} fail as blank_lines`, () => {
      const body = `Dzień dobry,\n${`${char}\n`.repeat(50)}Tak, wtorek.`;
      expect(failuresOf(body)).toContain("blank_lines");
      // Three such lines fail, two pass.
      expect(failuresOf(`Dzień dobry,\n${`${char}\n`.repeat(3)}Tak, wtorek.`)).toContain("blank_lines");
      expect(failuresOf(`Dzień dobry,\n${`${char}\n`.repeat(2)}Tak, wtorek.`)).not.toContain("blank_lines");
    });
  }

  test("a line with text between invisible lines breaks the run", () => {
    expect(failuresOf("Tak,\n\u2800\n\u3164\nnie.\n\uffa0\n\u2800\nOK.")).not.toContain("blank_lines");
  });
});

describe("more pins", () => {
  test("a cut leaves a break: digits on both sides of a date or a time never join into one run", () => {
    expect(failuresOf("Tak, 123456 18.11.2026 1234567")).toEqual([]);
    expect(failuresOf("Tak, 123456 10:00 1234567")).toEqual([]);
  });

  test("every dash lookalike separates the digits of a phone number", () => {
    for (const dash of ["\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212"]) {
      expect({ dash, failures: failuresOf(`Tak, 600${dash}100${dash}200`) }).toEqual({ dash, failures: ["phone"] });
    }
  });

  test("the unknown-language limit is 80 characters of the text without extra white space and gaps", () => {
    const words = (length: number) => "Wtorek ".repeat(20).slice(0, length).trimEnd();
    expect(failuresOf(`${words(79)}`)).toEqual([]);
    expect(failuresOf(`${"Wtorek ".repeat(20).slice(0, 80)}x`)).toEqual(["language"]);
    // White space is collapsed before the count: 60 characters with many spaces are short.
    expect(failuresOf(`Wtorek${" ".repeat(60)}piątek${" ".repeat(60)}sala`)).toEqual([]);
    // A gap label does not count.
    expect(failuresOf(`Wtorek [[${"a".repeat(80)}]]`)).toEqual([]);
  });

  test("the Subject and Reply-To header names", () => {
    for (const name of ["Subject", "Reply-To", "reply-to", "SUBJECT"]) {
      expect({ name, failures: failuresOf(`Tak.\n${name}: x`) }).toEqual({ name, failures: ["header_line"] });
    }
  });

  test("a C1 control, a tab and a line feed: only the controls fail", () => {
    expect(failuresOf("Tak,\tnie\ntak")).toEqual([]);
    expect(failuresOf("Tak, \u007f")).toEqual(["control_chars"]);
    expect(failuresOf("Tak, \u0090")).toEqual(["control_chars"]);
    expect(failuresOf("Tak,\r\nnie")).toEqual([]);
  });
});
