import { describe, expect, test } from "bun:test";

import { decideCategory } from "./threshold";

describe("decideCategory", () => {
  test("below the default threshold gives unsure", () => {
    expect(decideCategory({ category: "info", confidence: 0.69 }, {})).toEqual({
      category: "unsure",
      belowThreshold: true,
    });
  });

  test("equal to the threshold is kept", () => {
    expect(decideCategory({ category: "info", confidence: 0.7 }, {})).toEqual({
      category: "info",
      belowThreshold: false,
    });
  });

  test("uses the threshold of the category from the policy", () => {
    const policy = { spam: { threshold: 0.95 }, info: { threshold: 0.3 } };
    expect(decideCategory({ category: "spam", confidence: 0.9 }, policy).category).toBe("unsure");
    expect(decideCategory({ category: "info", confidence: 0.4 }, policy).category).toBe("info");
  });
});
