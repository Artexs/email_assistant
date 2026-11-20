import { describe, expect, test } from "bun:test";

import { miniScenario, miniSentSlot, sentFixtureText, sentPlantedFixture } from "./fixtures";
import { checkSentCase, hasLabelWord, quotedBlockCount } from "./sent-checks";
import type { SentSlot, SentText } from "./sent-slot";

// miniSentSlot: English, short, signature, quoted, one thread mail, to client-a, cc kasia.
const slot: SentSlot = { ...miniSentSlot };
const codes = (s: SentSlot, text: SentText) => checkSentCase(s, text, miniScenario).map((issue) => issue.code);

describe("checkSentCase", () => {
  test("a fixture text passes", () => {
    expect(codes(slot, sentFixtureText(slot))).toEqual([]);
  });

  test("T2 a text without the signature line gives signature", () => {
    const text = sentFixtureText(slot);
    const without = { ...text, body: text.body.replace(miniScenario.executive.signature, "") };
    expect(codes(slot, without)).toEqual(["signature"]);
    // No signature wanted: no issue.
    expect(codes({ ...slot, style: { ...slot.style, signature: false } }, without)).toEqual([]);
  });

  test("a text in the other language gives lang; a text with no clear language does not", () => {
    const polish = sentFixtureText({ ...slot, lang: "pl" });
    expect(codes(slot, { ...polish, subject: "Sprawa" })).toContain("lang");
    expect(
      codes(slot, { ...sentFixtureText(slot), body: `x\n${miniScenario.executive.signature}\n> y` })
    ).not.toContain("lang");
  });

  test("the language is read from the own lines, not from the quoted mail", () => {
    const text = sentFixtureText(slot);
    const polishQuote = `${text.body}\n> ${"Dzień dobry, to jest bardzo ważne, ale nie mam czasu, więc proszę o pomoc. ".repeat(3)}`;
    expect(codes(slot, { ...text, body: polishQuote })).not.toContain("lang");
  });

  test("a text outside its length bucket gives length; quoted lines do not count", () => {
    const text = sentFixtureText(slot);
    const long = {
      ...text,
      body: `${text.body.split("\n")[0]} ${"word ".repeat(80)}\n${miniScenario.executive.signature}`,
    };
    expect(codes(slot, long)).toContain("length");
    const quotedOnly = { ...text, body: `${text.body}\n> ${"word ".repeat(200)}` };
    expect(codes(slot, quotedOnly)).not.toContain("length");
    expect(codes({ ...slot, style: { ...slot.style, length: "long" } }, text)).toContain("length");
  });

  test("a quoted slot needs one quoted block per thread mail; a block ends at a line without >", () => {
    const text = sentFixtureText(slot);
    expect(codes(slot, { ...text, body: text.body.split("\n\n")[0] as string })).toEqual(["thread_count"]);
    const two = { ...slot, thread: [...slot.thread, { ...(slot.thread[0] as SentSlot["thread"][number]) }] };
    expect(codes(two, text)).toEqual(["thread_count"]);
    expect(codes(two, sentFixtureText(two))).toEqual([]);
    // A slot that does not quote has no block rule.
    expect(codes({ ...slot, quoted: false }, { ...text, body: text.body.split("\n\n")[0] as string })).toEqual([]);
    expect(quotedBlockCount("a\n> b\n> c\n\nd\n  > e\n>")).toBe(2);
    expect(quotedBlockCount("no quote")).toBe(0);
  });

  test("T3 an injection case without its planted string gives planted_missing", () => {
    const injection: SentSlot = { ...slot, hardCases: ["injection_quote"] };
    const text = sentFixtureText(injection);
    expect(text.planted).toEqual([sentPlantedFixture]);
    expect(codes(injection, text)).toEqual([]);
    const noList: SentText = { ...text };
    delete noList.planted;
    expect(codes(injection, noList)).toEqual(["planted_missing"]);
    expect(codes(injection, { ...text, body: text.body.replace(sentPlantedFixture, "other") })).toEqual([
      "planted_missing",
    ]);
    // A slot with no injection tag needs none.
    expect(codes(slot, noList)).toEqual([]);
  });

  test("the body holds no label word", () => {
    const text = sentFixtureText(slot);
    expect(codes(slot, { ...text, body: `${text.body}\nexpects_reply: true` })).toEqual(["label_word"]);
    expect(codes(slot, { ...text, subject: "promiseDue" })).toEqual(["label_word"]);
    expect(hasLabelWord("Due: Friday")).toBe(true);
    expect(hasLabelWord("  promise = yes")).toBe(true);
    expect(hasLabelWord("Expects reply: yes")).toBe(true);
    // Ordinary words are no label words.
    expect(hasLabelWord("The invoice is due on Friday. I promise to send it.\nDue to the delay we wait.")).toBe(false);
  });

  test("own_only: a recipient that is the executive", () => {
    const text = sentFixtureText(slot);
    expect(codes({ ...slot, to: ["szef"] }, text)).toEqual(["own_only"]);
    expect(codes({ ...slot, cc: ["szef"] }, text)).toEqual(["own_only"]);
    expect(codes(slot, text)).toEqual([]);
  });

  test("the data rule: an address, a URL or a phone number outside the reserved names", () => {
    const text = sentFixtureText(slot);
    expect(codes(slot, { ...text, body: `${text.body}\nreal@gmail.com` })).toEqual(["address_not_reserved"]);
    expect(codes(slot, { ...text, body: `${text.body}\nhttps://shop.real-company.com/x` })).toContain(
      "url_not_reserved"
    );
    expect(codes(slot, { ...text, body: `${text.body}\n501234567890` })).toEqual(["phone_number"]);
  });

  test("a text of another slot gives slot_unknown", () => {
    expect(codes(slot, { ...sentFixtureText(slot), id: "s-0002" })).toEqual(["slot_unknown"]);
  });

  test("an issue holds an id and a code, never mail text", () => {
    const issues = checkSentCase(slot, { ...sentFixtureText(slot), body: "secret-text expects_reply" }, miniScenario);
    expect(JSON.stringify(issues)).not.toContain("secret-text");
  });
});

describe("checkSentCase rules", () => {
  // Words of the English stopword list: a text of `count` words reads as English.
  const english = (count: number) =>
    Array.from({ length: count }, (_, i) => ["please", "send", "the", "report", "thanks"][i % 5]).join(" ");
  const plain = (length: SentSlot["style"]["length"], over: Partial<SentSlot> = {}): SentSlot => ({
    ...slot,
    quoted: false,
    thread: [],
    style: { length, greeting: "none", signature: false },
    ...over,
  });
  const body = (text: string): SentText => ({ id: slot.id, subject: "Report", body: text });
  const signature = miniScenario.executive.signature;

  test.each([
    { length: "short", words: 60, ok: true },
    { length: "short", words: 61, ok: false },
    { length: "medium", words: 39, ok: false },
    { length: "medium", words: 40, ok: true },
    { length: "medium", words: 200, ok: true },
    { length: "medium", words: 201, ok: false },
    { length: "long", words: 149, ok: false },
    { length: "long", words: 150, ok: true },
  ] as const)("a $length mail of $words words fits: $ok", ({ length, words, ok }) => {
    expect(codes(plain(length), body(english(words)))).toEqual(ok ? [] : ["length"]);
  });

  test("words count by any run of spaces, tabs and line breaks", () => {
    const sixty = Array.from({ length: 60 }, () => "please").join("  \n\t");
    expect(codes(plain("short"), body(sixty))).toEqual([]);
    expect(codes(plain("short"), body(`${sixty} the`))).toEqual(["length"]);
  });

  test("quoted lines, with leading spaces or a carriage return, do not count as words", () => {
    const own = english(60);
    expect(codes(plain("short"), body(`${own}\r\n> ${english(50)}\r\n  > ${english(50)}`))).toEqual([]);
    expect(codes(plain("short"), body(`${own}\n> ${english(50)}\nplease`))).toEqual(["length"]);
  });

  test("a quoted block ends at a line without a quote mark, also with carriage returns", () => {
    expect(quotedBlockCount("a\r\n> b\r\n\r\n> c")).toBe(2);
    expect(quotedBlockCount("> a\n> b")).toBe(1);
    expect(quotedBlockCount("")).toBe(0);
  });

  test("the thread count is the number of quoted blocks, and a short count gives thread_count", () => {
    const quoted = plain("short", { quoted: true, thread: slot.thread });
    expect(codes(quoted, body(`${english(20)}\n\n> ${english(5)}`))).toEqual([]);
    expect(codes(quoted, body(`${english(20)}\n\n> ${english(5)}\n\n> ${english(5)}`))).toEqual(["thread_count"]);
    expect(codes(quoted, body(english(20)))).toEqual(["thread_count"]);
  });

  test("the signature must be in the body; a scenario with no signature asks for none", () => {
    const wanted = plain("short", { style: { length: "short", greeting: "none", signature: true } });
    expect(codes(wanted, body(`${english(20)}\n${signature}`))).toEqual([]);
    expect(codes(wanted, body(english(20)))).toEqual(["signature"]);
    const noSignature = { ...miniScenario, executive: { ...miniScenario.executive, signature: "" } };
    expect(checkSentCase(wanted, body(english(20)), noSignature)).toEqual([]);
  });

  test("the language reads the subject with the own lines", () => {
    const polishSubject = { ...body(english(20)), subject: "Proszę o pomoc, dziękuję bardzo za to" };
    expect(codes(plain("short"), polishSubject)).toEqual([]);
    expect(codes(plain("short", { lang: "pl" }), body(english(20)))).toEqual(["lang"]);
  });

  test.each([
    {
      part: "the subject",
      text: { ...body(english(20)), subject: "mail real@gmail.com" },
      code: "address_not_reserved",
    },
    {
      part: "the subject",
      text: { ...body(english(20)), subject: "see https://shop.real-company.com/x" },
      code: "url_not_reserved",
    },
    { part: "the subject", text: { ...body(english(20)), subject: "call 501234567890" }, code: "phone_number" },
    { part: "a quoted line", text: body(`${english(20)}\n> real@gmail.com`), code: "address_not_reserved" },
  ] as const)("an open data item in $part gives $code", ({ text, code }) => {
    expect(codes(plain("short"), text)).toEqual([code]);
  });

  test("every planted string is needed, in any letter case, in the body only", () => {
    const injection = plain("short", { hardCases: ["injection_quote"] });
    const text = (planted: string[], over: Partial<SentText> = {}) => ({
      ...body(`${english(20)}\nCode Alpha-1 and Beta-2`),
      planted,
      ...over,
    });
    expect(codes(injection, text(["code ALPHA-1", "beta-2"]))).toEqual([]);
    expect(codes(injection, text(["alpha-1", "gamma-3"]))).toEqual(["planted_missing"]);
    expect(codes(injection, text([]))).toEqual(["planted_missing"]);
    expect(codes(injection, text(["gamma-3"], { subject: "gamma-3" }))).toEqual(["planted_missing"]);
  });

  test("a label word in the subject or the body gives label_word", () => {
    expect(codes(plain("short"), { ...body(english(20)), subject: "has_promise" })).toEqual(["label_word"]);
    expect(codes(plain("short"), body(`${english(20)}\nDue: Friday`))).toEqual(["label_word"]);
  });

  test.each([
    { word: "expects_reply", found: true },
    { word: "expectsreply", found: true },
    { word: "promise_due", found: true },
    { word: "promisedue", found: true },
    { word: "has_promise", found: true },
    { word: "haspromise", found: true },
    { word: "my EXPECTS_REPLY flag", found: true },
    { word: "not_has_promise_at_all", found: false },
    { word: "expects_replies", found: false },
  ])("the identifier $word is a label word: $found", ({ word, found }) => {
    expect(hasLabelWord(word)).toBe(found);
  });

  test.each([
    { line: "expects reply: yes", found: true },
    { line: "expects_reply= no", found: true },
    { line: "PROMISE: tomorrow", found: true },
    { line: "due = Friday", found: true },
    { line: "the promise: tomorrow", found: false },
    { line: "promise to send it", found: false },
  ])("the line `$line` is a label field: $found", ({ line, found }) => {
    expect(hasLabelWord(`first line\n${line}`)).toBe(found);
  });

  test("a recipient that is the executive, in any letter case of the address, gives own_only", () => {
    const scenario = { ...miniScenario, executive: { ...miniScenario.executive, address: "Szef@Mini.TEST" } };
    const issues = checkSentCase({ ...plain("short"), to: ["szef"] }, body(english(20)), scenario);
    expect(issues).toEqual([{ id: slot.id, code: "own_only" }]);
  });

  test("a mail with many broken rules gives the issues in the order of the checks", () => {
    const broken = plain("long", { to: ["szef"], style: { length: "long", greeting: "none", signature: true } });
    const text = body(
      `real@gmail.com\n${"https://shop.real-company.com/x"}\n501234567890\n${english(10)}\nDue: Friday`
    );
    expect(codes(broken, text)).toEqual([
      "address_not_reserved",
      "url_not_reserved",
      "phone_number",
      "length",
      "signature",
      "label_word",
      "own_only",
    ]);
  });

  test("an unknown slot gives only slot_unknown with the slot id", () => {
    const text = { ...body(`real@gmail.com ${english(5)}`), id: "other" };
    expect(checkSentCase(slot, text, miniScenario)).toEqual([{ id: slot.id, code: "slot_unknown" }]);
  });
});
