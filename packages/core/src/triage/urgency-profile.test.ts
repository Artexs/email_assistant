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

  test("trims a label and defaults keywords", () => {
    const parsed = urgencyProfileSchema.parse({ topics: [{ label: " Fuzja z Beta " }] });
    expect(parsed.topics).toEqual([{ label: "Fuzja z Beta", keywords: [] }]);
  });
});
