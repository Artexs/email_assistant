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
