import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { buildTriageAnalysisSchema, CLARIFICATION_MAX_CHARS, TASK_MAX_CHARS } from "./analysis";
import { classifierCategories } from "./categories";

const valid = {
  category: "info",
  confidence: 0.8,
  reason_code: "fyi",
  reason: "Just information.",
  summary: null,
  fields: { due_date: "2026-11-04", language: "pl", delegate_id: null, task: null, clarification: null },
};

describe("buildTriageAnalysisSchema", () => {
  const schema = buildTriageAnalysisSchema(classifierCategories);

  test("accepts a valid answer", () => {
    expect(schema.parse(valid).category).toBe("info");
  });

  test("rejects a category outside the allowed list", () => {
    const noSpam = buildTriageAnalysisSchema(classifierCategories.filter((c) => c !== "spam"));
    expect(() => noSpam.parse({ ...valid, category: "spam" })).toThrow();
  });

  test("rejects unsure and delegation from the classifier list", () => {
    expect(() => schema.parse({ ...valid, category: "unsure" })).toThrow();
    expect(() => schema.parse({ ...valid, category: "delegation" })).toThrow();
  });

  test("rejects confidence 1.2", () => {
    expect(() => schema.parse({ ...valid, confidence: 1.2 })).toThrow();
  });

  test("rejects a bad due_date", () => {
    expect(() => schema.parse({ ...valid, fields: { ...valid.fields, due_date: "04.11.2026" } })).toThrow();
  });

  test("delegate_id: with ids accepts an id and null, refuses another id", () => {
    const withIds = buildTriageAnalysisSchema(classifierCategories, ["a", "b"]);
    expect(withIds.parse({ ...valid, fields: { ...valid.fields, delegate_id: "a" } }).fields.delegate_id).toBe("a");
    expect(withIds.parse(valid).fields.delegate_id).toBeNull();
    expect(() => withIds.parse({ ...valid, fields: { ...valid.fields, delegate_id: "c" } })).toThrow();
  });

  test("delegate_id: with no ids refuses any id and accepts null", () => {
    expect(() => schema.parse({ ...valid, fields: { ...valid.fields, delegate_id: "a" } })).toThrow();
    expect(schema.parse(valid).fields.delegate_id).toBeNull();
  });

  test("task and clarification limits", () => {
    const parse = (extra: object) => schema.parse({ ...valid, fields: { ...valid.fields, ...extra } });
    expect(parse({ task: "t".repeat(TASK_MAX_CHARS) }).fields.task).toHaveLength(300);
    expect(() => parse({ task: "t".repeat(TASK_MAX_CHARS + 1) })).toThrow();
    expect(parse({ clarification: "c".repeat(CLARIFICATION_MAX_CHARS) }).fields.clarification).toHaveLength(200);
    expect(() => parse({ clarification: "c".repeat(CLARIFICATION_MAX_CHARS + 1) })).toThrow();
  });

  test("the v1 fields still parse", () => {
    const parsed = schema.parse(valid);
    expect(parsed.fields.due_date).toBe("2026-11-04");
    expect(parsed.fields.language).toBe("pl");
  });

  test("JSON schema: delegate_id is anyOf the enum and null", () => {
    const withIds = buildTriageAnalysisSchema(classifierCategories, ["a", "b"]);
    const json = z.toJSONSchema(withIds) as unknown as {
      properties: { fields: { properties: { delegate_id: { anyOf: Record<string, unknown>[] } } } };
    };
    const anyOf = json.properties.fields.properties.delegate_id.anyOf;
    expect(anyOf).toContainEqual({ type: "string", enum: ["a", "b"] });
    expect(anyOf).toContainEqual({ type: "null" });
  });
});
