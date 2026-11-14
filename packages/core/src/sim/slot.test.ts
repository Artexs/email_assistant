import { describe, expect, test } from "bun:test";

import { slotBatchFileSchema, slotSchema } from "./slot";

const base = {
  id: "b-inf-0001",
  part: "dev",
  batch: "batch-001",
  persona: "client-a",
  to: ["szef"],
  lang: "en",
  receivedAt: "2026-03-02T09:00:00.000Z",
  category: "info",
  kind: "synthetic",
  style: { length: "short", format: "plain", signature: true, greeting: "formal" },
  brief: "a short status update",
};

describe("slotSchema", () => {
  test("accepts a minimal slot and fills the defaults", () => {
    const slot = slotSchema.parse(base);
    expect(slot.direction).toBe("in");
    expect(slot.cc).toEqual([]);
    expect(slot.hardCases).toEqual([]);
    expect(slot.headers).toEqual({});
    expect(slot.attachments).toEqual([]);
    expect(slot.thread).toEqual([]);
  });

  test("an urgent slot needs an urgency source, and only an urgent slot may have one", () => {
    expect(slotSchema.safeParse({ ...base, category: "urgent" }).success).toBe(false);
    expect(slotSchema.safeParse({ ...base, category: "urgent", urgencySource: "text" }).success).toBe(true);
    expect(slotSchema.safeParse({ ...base, urgencySource: "text" }).success).toBe(false);
  });

  test("contextRef goes with urgency source context", () => {
    const urgent = { ...base, category: "urgent" };
    const ref = { kind: "topic", index: 0 };
    expect(slotSchema.safeParse({ ...urgent, urgencySource: "context" }).success).toBe(false);
    expect(slotSchema.safeParse({ ...urgent, urgencySource: "context", contextRef: ref }).success).toBe(true);
    expect(slotSchema.safeParse({ ...urgent, urgencySource: "vip", contextRef: ref }).success).toBe(false);
  });

  test("expectedDraft goes with category delegation", () => {
    expect(slotSchema.safeParse({ ...base, category: "delegation" }).success).toBe(false);
    expect(slotSchema.safeParse({ ...base, category: "delegation", expectedDraft: "delegation" }).success).toBe(true);
    expect(slotSchema.safeParse({ ...base, expectedDraft: "none" }).success).toBe(false);
  });

  test("refuses an unknown hard-case tag, an unknown key and a bad id", () => {
    expect(slotSchema.safeParse({ ...base, hardCases: ["no_such_tag"] }).success).toBe(false);
    expect(slotSchema.safeParse({ ...base, hardCases: ["german"], lang: "de" }).success).toBe(true);
    expect(slotSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(slotSchema.safeParse({ ...base, id: "B 1" }).success).toBe(false);
  });

  test("a batch file holds 1 to 25 slots", () => {
    const file = { scenario: "lab-01", part: "dev", batch: "batch-001" };
    expect(slotBatchFileSchema.safeParse({ ...file, slots: [] }).success).toBe(false);
    expect(slotBatchFileSchema.safeParse({ ...file, slots: [base] }).success).toBe(true);
    expect(slotBatchFileSchema.safeParse({ ...file, slots: Array(26).fill(base) }).success).toBe(false);
  });
});
