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

  test("digit counts: 8 digits pass, 9 to 11 are a phone, 12 or more an account number", () => {
    expect(failuresOf("Tak, 12345678")).toEqual([]);
    expect(failuresOf("Tak, 123456789")).toEqual(["phone"]);
    expect(failuresOf("Tak, 12345678901")).toEqual(["phone"]);
    expect(failuresOf("Tak, 123456789012")).toEqual(["account_number"]);
    expect(failuresOf("Tak, 1234567890123")).toEqual(["account_number"]);
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
  test("Polish has 30 distinct words, English 33, and the lists share none", () => {
    expect(new Set(POLISH_WORDS).size).toBe(30);
    expect(new Set(ENGLISH_WORDS).size).toBe(33);
    expect(POLISH_WORDS.filter((word) => (ENGLISH_WORDS as readonly string[]).includes(word))).toEqual([]);
  });
});

describe("pins of the number rules", () => {
  test("a spaced scheme is read through its spaces", () => {
    expect(failuresOf("Tak, h t t p s ://x.zzzz/a")).toEqual(["link"]);
    expect(failuresOf("Tak, h t t p ://x.zzzz/a")).toEqual(["link"]);
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

  test("an English draft of only a greeting and topic lines with gaps passes as en", () => {
    const body =
      "Dear Karin Lindqvist,\nRegarding certificate responsibility: [[accept or decline]].\nRegarding shipment arrival: [[yes or no and date]].";
    expect(failuresOf(body, "en")).toEqual([]);
    expect(failuresOf(body, "pl")).toEqual(["language"]);
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
    "\u180f",
    "\u200c",
    "\u200f",
    "\ufeff",
    "\u00ad",
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
  test("every dash lookalike separates the digits of a phone number", () => {
    for (const dash of ["\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212"]) {
      expect({ dash, failures: failuresOf(`Tak, 600${dash}100${dash}200`) }).toEqual({ dash, failures: ["phone"] });
    }
  });

  test("the unknown-language limit is 80 characters of the text without extra white space and gaps", () => {
    const words = (length: number) => "Wtorek ".repeat(20).slice(0, length).trimEnd();
    expect(failuresOf(`${words(79)}`)).toEqual([]);
    expect(failuresOf("x".repeat(79))).toEqual([]);
    expect(failuresOf("x".repeat(80))).toEqual(["language"]);
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
    expect(failuresOf("Tak, \u2028")).toEqual(["control_chars"]);
    expect(failuresOf("Tak, \u2029")).toEqual(["control_chars"]);
    expect(failuresOf("Tak,\r\nnie")).toEqual([]);
  });
});

describe("pins of the second re-review", () => {
  const tlds =
    "com net org pl eu io info biz co de uk ru cn xyz top app dev online site ly me tv cc ai example test gov edu fr nl cz sk ua us tk ml ga cf gq link click shop store cloud page live work tech".split(
      " "
    );
  test("each top-level domain of the list makes a bare domain a link", () => {
    expect(tlds).toHaveLength(48);
    for (const tld of tlds) {
      expect({ tld, failures: failuresOf(`Tak, patrz evil.${tld}`) }).toEqual({ tld, failures: ["link"] });
    }
    expect(failuresOf("Tak, patrz evil.com/a/b")).toEqual(["link"]);
    expect(failuresOf("Tak, patrz evil.zzzz")).toEqual([]);
    expect(failuresOf("Tak, patrz evilcom")).toEqual([]);
  });

  test("an address ends at a delimiter: the key is the same address", () => {
    for (const delimiter of ["<", ">", "(", ")", "[", "]", ",", ";", ":", '"', "'", "`"]) {
      for (const body of [
        `Tak, ${delimiter}jan@firma.pl${delimiter}.`,
        `Tak, ${delimiter}jan@firma.pl`,
        `Tak, jan@firma.pl${delimiter}`,
      ]) {
        expect({ body, failures: failuresOf(body, "pl", ["jan@firma.pl"]) }).toEqual({ body, failures: [] });
      }
    }
    expect(failuresOf("Tak, jan@firma.pl.", "pl", ["jan@firma.pl"])).toEqual([]);
    expect(failuresOf("Tak, jan@firma.pl?!", "pl", ["jan@firma.pl"])).toEqual([]);
    expect(failuresOf("Tak, jan@firma.pl", "pl", ["ewa@firma.pl"])).toEqual(["address"]);
  });

  test("a scheme of up to 20 characters is a link", () => {
    expect(failuresOf("Tak, abcdefghij://x")).toEqual(["link"]);
    expect(failuresOf("Tak, abcdefghijklmnopqrst://x")).toEqual(["link"]);
  });

  test("each named entity is read", () => {
    const cases: [string, ReplyCheckCode][] = [
      ["jan&commat;firma.pl", "address"],
      ["jan@firma&period;pl", "address"],
      ["jan&amp;commat;firma.pl", "address"],
      ["https&colon;//x.zzzz", "link"],
      ["https:&sol;&sol;x.zzzz", "link"],
      ["jan&lsqb;at&rsqb;firma&lsqb;dot&rsqb;pl", "address"],
      ["jan&lbrack;at&rbrack;firma&lbrack;dot&rbrack;pl", "address"],
      ["jan&lpar;at&rpar;firma&lpar;dot&rpar;pl", "address"],
      ["jan&lt;at&gt;firma&lt;dot&gt;pl", "address"],
      ["600&hyphen;100&hyphen;200", "phone"],
      ["4111&comma;1111&comma;1111&comma;1111", "account_number"],
      ["JAN&COMMAT;firma.pl", "address"],
    ];
    for (const [body, code] of cases)
      expect({ body, failures: failuresOf(`Tak, ${body}`) }).toEqual({ body, failures: [code] });
  });

  test("a letter of another script that looks like a Latin letter is read as that letter", () => {
    const cases: [string, string][] = [
      ["а", "evil.аi"],
      ["е", "evil.еu"],
      ["о", "evil.cоm"],
      ["р", "evil.рl"],
      ["с", "evil.сom"],
      ["х", "evil.хyz"],
      ["у", "evil.xуz"],
      ["і", "evil.іo"],
      ["ѕ", "evil.ѕite"],
      ["һ", "evil.sһop"],
      ["ԁ", "evil.ԁe"],
      ["ɡ", "evil.ɡov"],
      ["ο", "evil.cοm"],
      ["α", "evil.αi"],
      ["ε", "evil.εu"],
      ["ν", "evil.liνe"],
      ["τ", "evil.τech"],
      ["ρ", "evil.ρl"],
      ["ι", "evil.ιo"],
      ["κ", "evil.linκ"],
      ["ѵ", "evil.liѵe"],
      ["capital Cyrillic О", "evil.CОM"],
    ];
    for (const [name, host] of cases)
      expect({ name, failures: failuresOf(`Tak, patrz ${host}`) }).toEqual({ name, failures: ["link"] });
    expect(failuresOf("Tak.\nSubјect: x")).toEqual(["header_line"]);
    expect(failuresOf("Tak.\nFrоm: x")).toEqual(["header_line"]);
  });

  test("the plain view is scanned too: a form that decoding destroys", () => {
    expect(failuresOf("Tak, 4111%411111%411111%41111")).toContain("account_number");
  });

  test("a thin space, a no-break space and an ideographic space between digits are separators", () => {
    expect(failuresOf("Tak, NL91 ABNA 0417 1643 00")).toEqual(["account_number"]);
    expect(failuresOf("Tak, 600 100 200")).toEqual(["phone"]);
    expect(failuresOf("Tak, 600　100　200")).toEqual(["phone"]);
  });

  test("more invisible blank lines: variation selectors supplement, fillers, tags and the null notehead", () => {
    for (const code of [
      0xe0100, 0xe01ef, 0x16fe4, 0x1d159, 0x1d173, 0x1bca0, 0xe0020, 0xe0001, 0x2800, 0xfffc, 0x3164, 0xffa0,
    ]) {
      const char = String.fromCodePoint(code);
      const body = `Dzień dobry,\n${`${char}\n`.repeat(50)}Tak, wtorek.`;
      expect({ code: code.toString(16), failures: failuresOf(body) }).toMatchObject({
        failures: expect.arrayContaining(["blank_lines"]),
      });
    }
  });
});

describe("pins of the link and address keys (mutation survivors)", () => {
  test("a scheme keeps its first characters in the key (up to 20)", () => {
    expect(failuresOf("Tak, xyzdefghij://x.example dziękuję", "pl", ["abcdefghij://x.example"])).toEqual(["link"]);
    expect(
      failuresOf("Tak, zBCDEFGHIJKLMNOPQRST://x.example dziękuję", "pl", ["aBCDEFGHIJKLMNOPQRST://x.example"])
    ).toEqual(["link"]);
    expect(failuresOf("Tak, abcdefghij://x.example dziękuję", "pl", ["abcdefghij://x.example"])).toEqual([]);
  });

  test("each scheme without slashes is a link", () => {
    for (const scheme of ["mailto", "tel", "javascript", "data", "file", "ftp", "sms", "callto", "vbscript", "ssh"]) {
      expect({ scheme, failures: failuresOf(`Tak, ${scheme}:abc`) }).toEqual({ scheme, failures: ["link"] });
    }
  });

  test("an address never holds an at sign in its local part", () => {
    // The address is y@firma.pl, the part after the last at sign.
    expect(failuresOf("Tak, x@y@firma.pl dziękuję", "pl", ["y@firma.pl"])).toEqual([]);
    expect(failuresOf("Tak, y@firma.pl dziękuję", "pl", ["y@firma.pl"])).toEqual([]);
  });

  test("a link or an address loses the punctuation at its end", () => {
    for (const mark of [".", ",", ";", ":", "!", "?", ")", "]", "}", ">", '"', "'", "`"]) {
      const link = `Tak, patrz https://x.example/a${mark}`;
      expect({ link, failures: failuresOf(link, "pl", ["https://x.example/a"]) }).toEqual({ link, failures: [] });
      const bare = `Tak, patrz evil.com/a${mark}`;
      expect({ bare, failures: failuresOf(bare, "pl", ["evil.com/a"]) }).toEqual({ bare, failures: [] });
      const address = `Tak, patrz jan@firma.pl${mark}`;
      expect({ address, failures: failuresOf(address, "pl", ["jan@firma.pl"]) }).toEqual({ address, failures: [] });
    }
  });

  test("a bare domain: the path, the end, the labels and the place before it", () => {
    expect(failuresOf("Tak, evil.com/b", "pl", ["evil.com/a"])).toEqual(["link"]);
    expect(failuresOf("Tak, evil.community")).toEqual([]);
    expect(failuresOf("Tak, other-site.com", "pl", ["my-site.com"])).toEqual(["link"]);
    expect(failuresOf("Tak, xwww.y.zzzz")).toEqual([]);
    // The domain of an address is no link: after the at sign, after a dot or a hyphen of it.
    expect(failuresOf("Tak, jan@mail.firma.pl")).toEqual(["address"]);
    expect(failuresOf("Tak, jan@my-firma.pl")).toEqual(["address"]);
    expect(failuresOf("Tak, jan@mail.firma.pl", "pl", ["jan@mail.firma.pl"])).toEqual([]);
    expect(failuresOf("Tak, jan@my-firma.pl", "pl", ["jan@my-firma.pl"])).toEqual([]);
    expect(failuresOf("Tak, jan%40firma.pl", "pl", ["jan@firma.pl"])).toEqual([]);
    expect(failuresOf("Tak, jan&#64;firma.pl", "pl", ["jan@firma.pl"])).toEqual([]);
  });

  test("a link key is lower case with its white space collapsed", () => {
    expect(failuresOf("Tak, https://x.example/a", "pl", ["HTTPS://X.EXAMPLE/A"])).toEqual([]);
  });

  test("a space that is no plain space separates the digits of a phone number", () => {
    expect(failuresOf("Tak, 600\u1680100\u1680200")).toEqual(["phone"]);
    expect(failuresOf("Tak, 600\u2009100\u2009200")).toEqual(["phone"]);
  });

  test("złotówek is a currency", () => {
    expect(failuresOf("Tak, 123 456 789 złotówek dziękuję")).toEqual([]);
    expect(failuresOf("Tak, 123 456 789 złotówki dziękuję")).toEqual([]);
    expect(failuresOf("Tak, 123 456 789 dolarów dziękuję")).toEqual([]);
  });
});

describe("the fold of the views (marks and entity codes)", () => {
  test("a mark inside an address, a domain or a scheme changes nothing", () => {
    expect(failuresOf("Tak, napisz na jan@fírma.pl dziękuję")).toEqual(["address"]);
    expect(failuresOf("Tak, napisz na jan@firma.p️l dziękuję")).toEqual(["address"]);
    expect(failuresOf("Tak, patrz ev̲il.com dziękuję")).toEqual(["link"]);
    expect(failuresOf("Tak, patrz h͏tt͏ps://x.zzzz dziękuję")).toEqual(["link"]);
    expect(failuresOf("Tak.\nSub́ject: x")).toEqual(["header_line"]);
  });

  test("a letter with an accent is the plain letter in the views; the language check reads the original text", () => {
    expect(failuresOf("Tak, patrz evíl.com dziękuję")).toEqual(["link"]);
    expect(failuresOf("Dzień dobry, tak, dziękuję bardzo, wtorek mi pasuje.")).toEqual([]);
  });

  test("a code that is a control character or out of range stays as text; a space is decoded", () => {
    expect(failuresOf("Tak.%0ABcc: x")).toEqual([]);
    expect(() =>
      failuresOf("Tak, &#9999999; &#x110000; &#1114112; &#1114111; &#x10ffff; \\ud800 \\u0007")
    ).not.toThrow();
    expect(failuresOf("Tak, &#x110000; dziękuję")).toEqual([]);
    expect(failuresOf("Tak.\n%20Bcc: x")).toEqual(["header_line"]);
    expect(failuresOf("Tak.\n&#32;Bcc: x")).toEqual(["header_line"]);
  });
});
