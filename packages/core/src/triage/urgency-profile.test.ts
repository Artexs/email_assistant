import { describe, expect, test } from "bun:test";

import { urgencyProfileSchema } from "./urgency-profile";

describe("urgencyProfileSchema", () => {
  test("an empty object parses to empty lists", () => {
    expect(urgencyProfileSchema.parse({})).toEqual({ topics: [], deadlines: [] });
  });

  test("refuses too many items, a long label, an invalid date and an extra key", () => {
    const topic = { label: "Fuzja" };
    expect(urgencyProfileSchema.safeParse({ topics: Array.from({ length: 21 }, () => topic) }).success).toBe(false);
    expect(urgencyProfileSchema.safeParse({ topics: [{ label: "x".repeat(81) }] }).success).toBe(false);
    expect(urgencyProfileSchema.safeParse({ deadlines: [{ label: "Termin", due: "2027-02-30" }] }).success).toBe(false);
    expect(urgencyProfileSchema.safeParse({ topics: [], extra: 1 }).success).toBe(false);
  });

  test("refuses a NUL character in a label and in a keyword, with the code nul_char", () => {
    const issues = (input: unknown) => {
      const result = urgencyProfileSchema.safeParse(input);
      return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}:${issue.message}`);
    };
    expect(issues({ topics: [{ label: "a\u0000b" }] })).toEqual(["topics.0.label:nul_char"]);
    expect(issues({ topics: [{ label: "a", keywords: ["x", "y\u0000"] }] })).toEqual(["topics.0.keywords.1:nul_char"]);
    expect(issues({ deadlines: [{ label: "\u0000", due: "2027-02-01" }] })).toEqual(["deadlines.0.label:nul_char"]);
    expect(urgencyProfileSchema.safeParse({ topics: [{ label: "a b", keywords: ["x\u0001"] }] }).success).toBe(true);
  });

  test("trims a label and defaults keywords", () => {
    const parsed = urgencyProfileSchema.parse({ topics: [{ label: " Fuzja z Beta " }] });
    expect(parsed.topics).toEqual([{ label: "Fuzja z Beta", keywords: [] }]);
  });
});
