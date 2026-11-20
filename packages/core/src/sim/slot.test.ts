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

function issuesOf(value: unknown) {
  const result = slotSchema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({ code: String(issue.code), path: issue.path, message: issue.message }));
}

describe("slotSchema refusals", () => {
  const urgent = { ...base, category: "urgent" };
  const ref = { kind: "topic", index: 0 };
  const urgencyIssue = {
    code: "custom",
    path: ["urgencySource"],
    message: "urgencySource is set if and only if the category is urgent",
  };
  const contextIssue = {
    code: "custom",
    path: ["contextRef"],
    message: "contextRef is set if and only if the urgency source is context",
  };
  const draftIssue = {
    code: "custom",
    path: ["expectedDraft"],
    message: "expectedDraft is set if and only if the category is delegation",
  };

  test.each([
    ["an urgent slot with no urgency source", urgent, [urgencyIssue]],
    ["a non-urgent slot with an urgency source", { ...base, urgencySource: "text" }, [urgencyIssue]],
    ["context urgency with no contextRef", { ...urgent, urgencySource: "context" }, [contextIssue]],
    ["a contextRef with another urgency source", { ...urgent, urgencySource: "vip", contextRef: ref }, [contextIssue]],
    ["a delegation with no expectedDraft", { ...base, category: "delegation" }, [draftIssue]],
    ["an expectedDraft on another category", { ...base, expectedDraft: "none" }, [draftIssue]],
    [
      "a non-urgent slot with an urgency source of context and no contextRef",
      { ...base, urgencySource: "context" },
      [urgencyIssue, contextIssue],
    ],
  ])("refuses %s with one exact issue list", (_name, value, expected) => {
    expect(issuesOf(value)).toEqual(expected);
  });
});
