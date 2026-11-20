import { describe, expect, test } from "bun:test";
import type { z } from "zod";

import { miniSentBlind, miniSentLabel, miniSentSlot, miniSentText } from "./fixtures";
import { sentBlindCaseSchema, sentLabelSchema, sentParts, sentSlotSchema, sentTextSchema } from "./sent-slot";
import { simParts } from "./slot";

const slotWith = (patch: Record<string, unknown>) => ({ ...miniSentSlot, ...patch });
const labelsWith = (patch: Record<string, unknown>) => ({ ...miniSentSlot.labels, ...patch });

describe("sent shapes", () => {
  test("T1 each schema accepts the fixture case", () => {
    expect(sentSlotSchema.parse(miniSentSlot)).toEqual(miniSentSlot);
    expect(sentTextSchema.parse(miniSentText)).toEqual(miniSentText);
    expect(sentBlindCaseSchema.parse(miniSentBlind)).toEqual(miniSentBlind);
    expect(sentLabelSchema.parse(miniSentLabel)).toEqual(miniSentLabel);
  });

  test("an ask or a promise over 80 characters is refused", () => {
    const long = "x".repeat(81);
    expect(sentSlotSchema.safeParse(slotWith({ labels: labelsWith({ ask: long }) })).success).toBe(false);
    expect(sentSlotSchema.safeParse(slotWith({ labels: labelsWith({ promise: long }) })).success).toBe(false);
  });

  test("ids, recipients and the quote follow the shape", () => {
    expect(sentSlotSchema.safeParse(slotWith({ id: "sh-thx-01" })).success).toBe(true);
    expect(sentSlotSchema.safeParse(slotWith({ id: "b-inf-0001" })).success).toBe(false);
    expect(sentSlotSchema.safeParse(slotWith({ part: "dev" })).success).toBe(false);
    expect(sentSlotSchema.safeParse(slotWith({ to: [] })).success).toBe(false);
    expect(sentSlotSchema.safeParse(slotWith({ to: Array.from({ length: 13 }, (_, i) => `p${i}`) })).success).toBe(
      false
    );
    expect(sentSlotSchema.safeParse(slotWith({ cc: ["client-a"] })).success).toBe(false);
    expect(sentSlotSchema.safeParse(slotWith({ to: ["szef"] })).success).toBe(false);
    expect(sentSlotSchema.safeParse(slotWith({ thread: [], quoted: true })).success).toBe(false);
    expect(sentSlotSchema.safeParse(slotWith({ lang: "de" })).success).toBe(false);
  });

  test("a thread holds at most 3 mails", () => {
    const mail = { from: "client-a", subject: "Temat", brief: "an earlier mail" };
    expect(sentSlotSchema.safeParse(slotWith({ thread: [mail, mail, mail] })).success).toBe(true);
    expect(sentSlotSchema.safeParse(slotWith({ thread: [mail, mail, mail, mail] })).success).toBe(false);
  });

  test("a brief over 300 characters is refused", () => {
    expect(sentSlotSchema.safeParse(slotWith({ brief: "x".repeat(300) })).success).toBe(true);
    expect(sentSlotSchema.safeParse(slotWith({ brief: "x".repeat(301) })).success).toBe(false);
  });

  test("the hard-case tags set the labels and the facts", () => {
    const quiet = labelsWith({ expectsReply: false, ask: null, due: null });
    const tagged = (tag: string, patch: Record<string, unknown> = {}) =>
      sentSlotSchema.safeParse(slotWith({ hardCases: [tag], ...patch })).success;
    expect(tagged("thanks_only")).toBe(false);
    expect(tagged("thanks_only", { labels: quiet })).toBe(true);
    expect(tagged("conditional_promise")).toBe(false);
    expect(tagged("conditional_promise", { labels: labelsWith({ promise: null, promiseDue: null }) })).toBe(true);
    expect(tagged("past_date")).toBe(false);
    expect(tagged("past_date", { labels: labelsWith({ due: null }) })).toBe(true);
    expect(tagged("time_word_due", { labels: labelsWith({ due: { kind: "date", date: "2026-11-20" } }) })).toBe(false);
    expect(tagged("time_word_due")).toBe(true);
    expect(tagged("many_recipients", { labels: quiet })).toBe(false);
    const allNull = labelsWith({ expectsReply: false, ask: null, due: null, promise: null, promiseDue: null });
    expect(tagged("many_recipients", { labels: allNull })).toBe(false);
    const many = Array.from({ length: 11 }, (_, i) => `p${i}`);
    expect(tagged("many_recipients", { labels: allNull, to: many, cc: [] })).toBe(true);
    expect(tagged("many_recipients", { labels: allNull, to: many.slice(0, 6), cc: many.slice(6) })).toBe(true);
    expect(tagged("many_recipients", { labels: allNull, to: many.slice(0, 10), cc: [] })).toBe(false);
    expect(tagged("injection_quote", { quoted: false })).toBe(false);
    expect(tagged("other_thread_subject", { thread: [], quoted: false })).toBe(false);
  });

  test("a blind case holds no label key and no slot field", () => {
    expect(sentBlindCaseSchema.safeParse({ ...miniSentBlind, labels: miniSentSlot.labels }).success).toBe(false);
    expect(sentBlindCaseSchema.safeParse({ ...miniSentBlind, hardCases: [] }).success).toBe(false);
    expect(Object.keys(miniSentBlind).sort()).toEqual(
      ["body", "cc", "from", "id", "sentAt", "subject", "threadSubjects", "to"].sort()
    );
  });

  test("a label date is a calendar day and the hash is sha256 hex", () => {
    expect(sentLabelSchema.safeParse({ ...miniSentLabel, due: "20.11.2026" }).success).toBe(false);
    expect(sentLabelSchema.safeParse({ ...miniSentLabel, blindHash: "abc" }).success).toBe(false);
  });

  test("T2 the sent parts and the incoming parts share no member", () => {
    expect(sentParts.filter((part) => (simParts as readonly string[]).includes(part))).toEqual([]);
    expect(simParts).toEqual(["dev", "holdout", "week"]);
  });
});

function refusals(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({ code: String(issue.code), path: issue.path, message: issue.message }));
}

const noReply = { expectsReply: false, ask: null, due: null };
const noLabels = { ...noReply, promise: null, promiseDue: null };
const dateDue = { kind: "date", date: "2026-11-20" };
const elevenPeople = Array.from({ length: 11 }, (_, i) => `p${i}`);

describe("sent slot refusals", () => {
  test.each([
    [
      "a recipient in to and cc",
      { to: ["client-a"], cc: ["client-a"] },
      [{ code: "custom", path: ["to"], message: "a recipient appears twice" }],
    ],
    [
      "the executive as a recipient",
      { to: ["client-a", "szef"] },
      [{ code: "custom", path: ["to"], message: "the executive is no recipient" }],
    ],
    [
      "the executive in cc",
      { cc: ["szef"] },
      [{ code: "custom", path: ["to"], message: "the executive is no recipient" }],
    ],
    [
      "a quote with no thread mail",
      { thread: [], quoted: true },
      [{ code: "custom", path: ["quoted"], message: "quoted needs a thread mail" }],
    ],
    [
      "an ask with no expected reply",
      { labels: labelsWith({ expectsReply: false, due: null }) },
      [{ code: "custom", path: ["labels.ask"], message: "ask is set if and only if expectsReply" }],
    ],
    [
      "an expected reply with no ask",
      { labels: labelsWith({ ask: null }) },
      [{ code: "custom", path: ["labels.ask"], message: "ask is set if and only if expectsReply" }],
    ],
    [
      "a due with no expected reply and no ask",
      { labels: labelsWith({ expectsReply: false, ask: null }) },
      [{ code: "custom", path: ["labels.due"], message: "due needs expectsReply" }],
    ],
    [
      "a due and an ask with no expected reply",
      { labels: labelsWith({ expectsReply: false }) },
      [
        { code: "custom", path: ["labels.ask"], message: "ask is set if and only if expectsReply" },
        { code: "custom", path: ["labels.due"], message: "due needs expectsReply" },
      ],
    ],
    [
      "a promise with no promiseDue",
      { labels: labelsWith({ promiseDue: null }) },
      [{ code: "custom", path: ["labels.promiseDue"], message: "promise and promiseDue are set together" }],
    ],
    [
      "a promiseDue with no promise",
      { labels: labelsWith({ promise: null }) },
      [{ code: "custom", path: ["labels.promiseDue"], message: "promise and promiseDue are set together" }],
    ],
  ])("refuses %s with one exact issue list", (_name, patch, expected) => {
    expect(refusals(sentSlotSchema, slotWith(patch))).toEqual(expected);
  });
});

describe("sent slot hard-case rules", () => {
  const word = { kind: "word", word: "friday" };
  test.each([
    [
      "thanks_only",
      {},
      [{ code: "custom", path: ["labels.expectsReply"], message: "thanks_only sets expectsReply to false" }],
    ],
    [
      "fyi_team",
      {},
      [{ code: "custom", path: ["labels.expectsReply"], message: "fyi_team sets expectsReply to false" }],
    ],
    [
      "question_in_forward",
      { labels: labelsWith({ expectsReply: false, ask: null, due: null }) },
      [{ code: "custom", path: ["labels.expectsReply"], message: "question_in_forward sets expectsReply to true" }],
    ],
    [
      "question_in_forward",
      { thread: [], quoted: false },
      [
        { code: "custom", path: ["thread"], message: "question_in_forward needs a thread mail" },
        { code: "custom", path: ["quoted"], message: "question_in_forward needs a quoted mail" },
      ],
    ],
    [
      "question_in_forward",
      { quoted: false },
      [{ code: "custom", path: ["quoted"], message: "question_in_forward needs a quoted mail" }],
    ],
    [
      "conditional_promise",
      {},
      [{ code: "custom", path: ["labels.promise"], message: "conditional_promise has no promise label" }],
    ],
    [
      "reported_speech",
      { labels: { ...noReply, promise: "send it", promiseDue: dateDue } },
      [{ code: "custom", path: ["labels.promise"], message: "reported_speech has no promise label" }],
    ],
    [
      "reported_speech",
      {},
      [
        { code: "custom", path: ["labels.expectsReply"], message: "reported_speech sets expectsReply to false" },
        { code: "custom", path: ["labels.promise"], message: "reported_speech has no promise label" },
      ],
    ],
    [
      "reply_to_ooo",
      { thread: [], quoted: false },
      [{ code: "custom", path: ["thread"], message: "reply_to_ooo needs a thread mail" }],
    ],
    [
      "other_thread_subject",
      { thread: [], quoted: false },
      [{ code: "custom", path: ["thread"], message: "other_thread_subject needs a thread mail" }],
    ],
    [
      "injection_quote",
      { thread: [], quoted: false },
      [
        { code: "custom", path: ["thread"], message: "injection_quote needs a thread mail" },
        { code: "custom", path: ["quoted"], message: "injection_quote needs a quoted mail" },
      ],
    ],
    [
      "injection_quote",
      { quoted: false },
      [{ code: "custom", path: ["quoted"], message: "injection_quote needs a quoted mail" }],
    ],
    [
      "time_word_due",
      { labels: labelsWith({ due: dateDue }) },
      [{ code: "custom", path: ["labels.due"], message: "time_word_due has a time-word due" }],
    ],
    [
      "time_word_due",
      { labels: labelsWith({ due: null }) },
      [{ code: "custom", path: ["labels.due"], message: "time_word_due has a time-word due" }],
    ],
    [
      "time_word_due",
      { labels: labelsWith({ expectsReply: false, ask: null, due: word }) },
      [
        { code: "custom", path: ["labels.due"], message: "due needs expectsReply" },
        { code: "custom", path: ["labels.expectsReply"], message: "time_word_due sets expectsReply to true" },
      ],
    ],
    ["past_date", {}, [{ code: "custom", path: ["labels.due"], message: "past_date has no due label" }]],
    ["far_date", {}, [{ code: "custom", path: ["labels.due"], message: "far_date has no due label" }]],
    [
      "far_date",
      { labels: labelsWith({ expectsReply: false, ask: null, due: null }) },
      [{ code: "custom", path: ["labels.expectsReply"], message: "far_date sets expectsReply to true" }],
    ],
    [
      "many_recipients",
      { labels: noLabels, to: elevenPeople.slice(0, 10), cc: [] },
      [{ code: "custom", path: ["to"], message: "many_recipients needs more than 10 recipients" }],
    ],
    [
      "many_recipients",
      { labels: noLabels, to: elevenPeople.slice(0, 5), cc: elevenPeople.slice(5, 10) },
      [{ code: "custom", path: ["to"], message: "many_recipients needs more than 10 recipients" }],
    ],
    [
      "many_recipients",
      { labels: { ...noLabels, promise: "send it", promiseDue: dateDue }, to: elevenPeople, cc: [] },
      [{ code: "custom", path: ["labels.promise"], message: "many_recipients has no promise label" }],
    ],
  ])("%s breaks its rule with one exact issue list", (tag, patch, expected) => {
    expect(refusals(sentSlotSchema, slotWith({ hardCases: [tag], ...patch }))).toEqual(expected);
  });
});

describe("sent label refusals", () => {
  test("the fixture label parses to its own value", () => {
    expect(sentLabelSchema.parse(miniSentLabel)).toEqual(miniSentLabel);
  });

  test.each([
    [
      "a promise with no promiseDue",
      { promise: true, promiseDue: null },
      [{ code: "custom", path: ["promiseDue"], message: "promise and promiseDue are set together" }],
    ],
    [
      "a promiseDue with no promise",
      { promise: false },
      [{ code: "custom", path: ["promiseDue"], message: "promise and promiseDue are set together" }],
    ],
    [
      "a due with no expected reply",
      { expectsReply: false },
      [{ code: "custom", path: ["due"], message: "due needs expectsReply" }],
    ],
    [
      "both rules broken",
      { expectsReply: false, promise: false },
      [
        { code: "custom", path: ["promiseDue"], message: "promise and promiseDue are set together" },
        { code: "custom", path: ["due"], message: "due needs expectsReply" },
      ],
    ],
  ])("refuses %s with one exact issue list", (_name, patch, expected) => {
    expect(refusals(sentLabelSchema, { ...miniSentLabel, ...patch })).toEqual(expected);
  });

  test("a label with no reply, no promise and no dates parses", () => {
    const quiet = { ...miniSentLabel, expectsReply: false, promise: false, due: null, promiseDue: null };
    expect(sentLabelSchema.parse(quiet)).toEqual(quiet);
  });
});
