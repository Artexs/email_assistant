import { describe, expect, test } from "bun:test";

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

  test("T1 the slot and the label refuse a promise with no promiseDue", () => {
    const noDue = sentSlotSchema.safeParse(slotWith({ labels: labelsWith({ promiseDue: null }) }));
    expect(noDue.success).toBe(false);
    const noPromise = sentSlotSchema.safeParse(slotWith({ labels: labelsWith({ promise: null }) }));
    expect(noPromise.success).toBe(false);
    expect(sentLabelSchema.safeParse({ ...miniSentLabel, promiseDue: null }).success).toBe(false);
    expect(sentLabelSchema.safeParse({ ...miniSentLabel, promise: false }).success).toBe(false);
  });

  test("the ask is set if and only if the mail expects a reply; a due needs a reply", () => {
    expect(sentSlotSchema.safeParse(slotWith({ labels: labelsWith({ ask: null }) })).success).toBe(false);
    const quiet = labelsWith({ expectsReply: false, ask: null, due: null });
    expect(sentSlotSchema.safeParse(slotWith({ labels: quiet })).success).toBe(true);
    expect(sentSlotSchema.safeParse(slotWith({ labels: labelsWith({ expectsReply: false }) })).success).toBe(false);
    const dueOnly = labelsWith({ expectsReply: false, ask: null });
    expect(sentSlotSchema.safeParse(slotWith({ labels: dueOnly })).success).toBe(false);
    expect(sentLabelSchema.safeParse({ ...miniSentLabel, expectsReply: false }).success).toBe(false);
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

  test("a brief over 300 characters is refused", () => {
    expect(sentSlotSchema.safeParse(slotWith({ brief: "x".repeat(300) })).success).toBe(true);
    expect(sentSlotSchema.safeParse(slotWith({ brief: "x".repeat(301) })).success).toBe(false);
  });

  test("a thread holds at most 3 mails", () => {
    const mail = { from: "client-a", subject: "Temat", brief: "an earlier mail" };
    expect(sentSlotSchema.safeParse(slotWith({ thread: [mail, mail, mail] })).success).toBe(true);
    expect(sentSlotSchema.safeParse(slotWith({ thread: [mail, mail, mail, mail] })).success).toBe(false);
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
