import { describe, expect, test } from "bun:test";

import { blindBatchFileSchema, caseTextSchema, labelBatchFileSchema, textBatchFileSchema } from "./files";

const text = { id: "b-inf-0001", subject: "Raport", body: "Dzień dobry" };
const hash = "a".repeat(64);
const labelFile = { scenario: "lab-01", part: "dev", batch: "batch-001", checker: "haiku" };

describe("caseTextSchema", () => {
  test("2 refuses a subject with a line break and an extra key; fills the thread", () => {
    expect(caseTextSchema.parse(text).thread).toEqual([]);
    expect(caseTextSchema.safeParse({ ...text, subject: "a\nb" }).success).toBe(false);
    expect(caseTextSchema.safeParse({ ...text, extra: 1 }).success).toBe(false);
    expect(caseTextSchema.safeParse({ ...text, dropped: false }).success).toBe(false);
  });

  test("a text batch holds a writer and cases", () => {
    const file = { scenario: "lab-01", part: "dev", batch: "batch-001", writer: "sonnet", cases: [text] };
    expect(textBatchFileSchema.safeParse(file).success).toBe(true);
    expect(textBatchFileSchema.safeParse({ ...file, writer: "" }).success).toBe(false);
  });
});

describe("blind and label files", () => {
  test("a blind case refuses a slot field", () => {
    const blind = {
      id: "x",
      from: "A <a@b.test>",
      to: [],
      cc: [],
      subject: "s",
      body: "b",
      thread: [],
      attachments: [],
    };
    const file = { scenario: "lab-01", part: "dev", batch: "batch-001", cases: [blind] };
    expect(blindBatchFileSchema.safeParse(file).success).toBe(true);
    expect(blindBatchFileSchema.safeParse({ ...file, cases: [{ ...blind, category: "info" }] }).success).toBe(false);
  });

  test("3 a label takes delegation and refuses unsure and a missing blindHash", () => {
    const label = (extra: object) => ({ ...labelFile, labels: [{ id: "x", ...extra }] });
    expect(labelBatchFileSchema.safeParse(label({ category: "delegation", blindHash: hash })).success).toBe(true);
    expect(labelBatchFileSchema.safeParse(label({ category: "unsure", blindHash: hash })).success).toBe(false);
    expect(labelBatchFileSchema.safeParse(label({ category: "delegation" })).success).toBe(false);
  });
});
