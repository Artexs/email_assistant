import { describe, expect, test } from "bun:test";

import { buildTriageAnalysisSchema } from "./analysis";
import { classifierCategories } from "./categories";

const valid = {
  category: "info",
  confidence: 0.8,
  reason_code: "fyi",
  reason: "Just information.",
  summary: null,
  fields: { due_date: "2026-11-04", language: "pl" },
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
    expect(() => schema.parse({ ...valid, fields: { due_date: "04.11.2026", language: "pl" } })).toThrow();
  });
});
