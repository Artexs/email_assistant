import { describe, expect, test } from "bun:test";

import { miniSentBlind, miniSentLabel, miniSentSlot, miniSentText } from "./fixtures";
import { sentHardCaseRules } from "./sent-hard-cases";
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

interface Refusal {
  path: PropertyKey[];
  message: string;
}

function refusals(
  schema: { safeParse(value: unknown): { success: boolean; error?: { issues: Refusal[] } } },
  value: unknown
): Refusal[] {
  const result = schema.safeParse(value);
  if (result.success) return [];
  return (result.error?.issues ?? []).map((issue) => ({ path: issue.path, message: issue.message }));
}

const noReply = { expectsReply: false, ask: null, due: null };
const noLabels = { ...noReply, promise: null, promiseDue: null };
const dateDue = { kind: "date", date: "2026-11-20" };
const elevenPeople = Array.from({ length: 11 }, (_, i) => `p${i}`);

describe("sent slot refusals", () => {
  test("the fixture slot parses to its own value", () => {
    expect(sentSlotSchema.parse(miniSentSlot)).toEqual(miniSentSlot);
  });

  test.each([
    [
      "a recipient in to and cc",
      { to: ["client-a"], cc: ["client-a"] },
      [{ path: ["to"], message: "a recipient appears twice" }],
    ],
    [
      "the executive as a recipient",
      { to: ["client-a", "szef"] },
      [{ path: ["to"], message: "the executive is no recipient" }],
    ],
    ["the executive in cc", { cc: ["szef"] }, [{ path: ["to"], message: "the executive is no recipient" }]],
    [
      "a quote with no thread mail",
      { thread: [], quoted: true },
      [{ path: ["quoted"], message: "quoted needs a thread mail" }],
    ],
    [
      "an ask with no expected reply",
      { labels: labelsWith({ expectsReply: false, due: null }) },
      [{ path: ["labels.ask"], message: "ask is set if and only if expectsReply" }],
    ],
    [
      "an expected reply with no ask",
      { labels: labelsWith({ ask: null }) },
      [{ path: ["labels.ask"], message: "ask is set if and only if expectsReply" }],
    ],
    [
      "a due with no expected reply and no ask",
      { labels: labelsWith({ expectsReply: false, ask: null }) },
      [{ path: ["labels.due"], message: "due needs expectsReply" }],
    ],
    [
      "a due and an ask with no expected reply",
      { labels: labelsWith({ expectsReply: false }) },
      [
        { path: ["labels.ask"], message: "ask is set if and only if expectsReply" },
        { path: ["labels.due"], message: "due needs expectsReply" },
      ],
    ],
    [
      "a promise with no promiseDue",
      { labels: labelsWith({ promiseDue: null }) },
      [{ path: ["labels.promiseDue"], message: "promise and promiseDue are set together" }],
    ],
    [
      "a promiseDue with no promise",
      { labels: labelsWith({ promise: null }) },
      [{ path: ["labels.promiseDue"], message: "promise and promiseDue are set together" }],
    ],
  ])("refuses %s with one exact issue list", (_name, patch, expected) => {
    expect(refusals(sentSlotSchema, slotWith(patch))).toEqual(expected);
  });

  test("a slot with no quoted and no list fields parses to the defaults", () => {
    const bare: Record<string, unknown> = { ...miniSentSlot };
    delete bare.quoted;
    delete bare.cc;
    delete bare.hardCases;
    delete bare.thread;
    const parsed = sentSlotSchema.parse(bare);
    expect(parsed.quoted).toBe(false);
    expect(parsed.cc).toEqual([]);
    expect(parsed.hardCases).toEqual([]);
    expect(parsed.thread).toEqual([]);
  });

  test("a brief of 300 characters parses, 301 and an empty brief do not", () => {
    expect(sentSlotSchema.parse(slotWith({ brief: "x".repeat(300) })).brief).toHaveLength(300);
    expect(sentSlotSchema.safeParse(slotWith({ brief: "x".repeat(301) })).success).toBe(false);
    expect(sentSlotSchema.safeParse(slotWith({ brief: "" })).success).toBe(false);
  });
});

describe("sent slot hard-case rules", () => {
  const word = { kind: "word", word: "friday" };
  test.each([
    ["thanks_only", {}, [{ path: ["labels.expectsReply"], message: "thanks_only sets expectsReply to false" }]],
    ["fyi_team", {}, [{ path: ["labels.expectsReply"], message: "fyi_team sets expectsReply to false" }]],
    [
      "question_in_forward",
      { labels: labelsWith({ expectsReply: false, ask: null, due: null }) },
      [{ path: ["labels.expectsReply"], message: "question_in_forward sets expectsReply to true" }],
    ],
    [
      "question_in_forward",
      { thread: [], quoted: false },
      [
        { path: ["thread"], message: "question_in_forward needs a thread mail" },
        { path: ["quoted"], message: "question_in_forward needs a quoted mail" },
      ],
    ],
    [
      "question_in_forward",
      { quoted: false },
      [{ path: ["quoted"], message: "question_in_forward needs a quoted mail" }],
    ],
    ["conditional_promise", {}, [{ path: ["labels.promise"], message: "conditional_promise has no promise label" }]],
    [
      "reported_speech",
      { labels: { ...noReply, promise: "send it", promiseDue: dateDue } },
      [{ path: ["labels.promise"], message: "reported_speech has no promise label" }],
    ],
    [
      "reported_speech",
      {},
      [
        { path: ["labels.expectsReply"], message: "reported_speech sets expectsReply to false" },
        { path: ["labels.promise"], message: "reported_speech has no promise label" },
      ],
    ],
    [
      "reply_to_ooo",
      { thread: [], quoted: false },
      [{ path: ["thread"], message: "reply_to_ooo needs a thread mail" }],
    ],
    [
      "other_thread_subject",
      { thread: [], quoted: false },
      [{ path: ["thread"], message: "other_thread_subject needs a thread mail" }],
    ],
    [
      "injection_quote",
      { thread: [], quoted: false },
      [
        { path: ["thread"], message: "injection_quote needs a thread mail" },
        { path: ["quoted"], message: "injection_quote needs a quoted mail" },
      ],
    ],
    ["injection_quote", { quoted: false }, [{ path: ["quoted"], message: "injection_quote needs a quoted mail" }]],
    [
      "time_word_due",
      { labels: labelsWith({ due: dateDue }) },
      [{ path: ["labels.due"], message: "time_word_due has a time-word due" }],
    ],
    [
      "time_word_due",
      { labels: labelsWith({ due: null }) },
      [{ path: ["labels.due"], message: "time_word_due has a time-word due" }],
    ],
    [
      "time_word_due",
      { labels: labelsWith({ expectsReply: false, ask: null, due: word }) },
      [
        { path: ["labels.due"], message: "due needs expectsReply" },
        { path: ["labels.expectsReply"], message: "time_word_due sets expectsReply to true" },
      ],
    ],
    ["past_date", {}, [{ path: ["labels.due"], message: "past_date has no due label" }]],
    ["far_date", {}, [{ path: ["labels.due"], message: "far_date has no due label" }]],
    [
      "far_date",
      { labels: labelsWith({ expectsReply: false, ask: null, due: null }) },
      [{ path: ["labels.expectsReply"], message: "far_date sets expectsReply to true" }],
    ],
    [
      "many_recipients",
      { labels: noLabels, to: elevenPeople.slice(0, 10), cc: [] },
      [{ path: ["to"], message: "many_recipients needs more than 10 recipients" }],
    ],
    [
      "many_recipients",
      { labels: noLabels, to: elevenPeople.slice(0, 5), cc: elevenPeople.slice(5, 10) },
      [{ path: ["to"], message: "many_recipients needs more than 10 recipients" }],
    ],
    [
      "many_recipients",
      { labels: { ...noLabels, promise: "send it", promiseDue: dateDue }, to: elevenPeople, cc: [] },
      [{ path: ["labels.promise"], message: "many_recipients has no promise label" }],
    ],
  ])("%s breaks its rule with one exact issue list", (tag, patch, expected) => {
    expect(refusals(sentSlotSchema, slotWith({ hardCases: [tag], ...patch }))).toEqual(expected);
  });

  test.each([
    ["thanks_only", { labels: noLabels }],
    ["fyi_team", { labels: noLabels }],
    ["question_in_forward", {}],
    ["conditional_promise", { labels: labelsWith({ promise: null, promiseDue: null }) }],
    ["reported_speech", { labels: noLabels }],
    ["let_me_know_if", {}],
    ["reply_to_ooo", {}],
    ["other_thread_subject", {}],
    ["injection_quote", {}],
    ["time_word_due", {}],
    ["past_date", { labels: labelsWith({ due: null }) }],
    ["far_date", { labels: labelsWith({ due: null }) }],
    ["many_recipients", { labels: noLabels, to: elevenPeople, cc: [] }],
    ["many_recipients", { labels: noLabels, to: elevenPeople.slice(0, 6), cc: elevenPeople.slice(6) }],
  ])("%s on a slot that meets its rule parses to the slot value", (tag, patch) => {
    const slot = slotWith({ hardCases: [tag], ...patch });
    expect(refusals(sentSlotSchema, slot)).toEqual([]);
    expect(sentSlotSchema.parse(slot)).toEqual(slot);
  });

  test("the table names the tags that the rows above cover", () => {
    expect(sentHardCaseRules.map((r) => r.id)).toEqual([
      "thanks_only",
      "fyi_team",
      "question_in_forward",
      "conditional_promise",
      "reported_speech",
      "let_me_know_if",
      "reply_to_ooo",
      "other_thread_subject",
      "injection_quote",
      "time_word_due",
      "past_date",
      "far_date",
      "many_recipients",
    ]);
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
      [{ path: ["promiseDue"], message: "promise and promiseDue are set together" }],
    ],
    [
      "a promiseDue with no promise",
      { promise: false },
      [{ path: ["promiseDue"], message: "promise and promiseDue are set together" }],
    ],
    ["a due with no expected reply", { expectsReply: false }, [{ path: ["due"], message: "due needs expectsReply" }]],
    [
      "both rules broken",
      { expectsReply: false, promise: false },
      [
        { path: ["promiseDue"], message: "promise and promiseDue are set together" },
        { path: ["due"], message: "due needs expectsReply" },
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
