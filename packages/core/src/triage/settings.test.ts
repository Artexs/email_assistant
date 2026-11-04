import { describe, expect, test } from "bun:test";

import { feedbackSources } from "./categories";
import { parseCategoryPolicy, parseToolSwitches, thresholdFor, autoFor } from "./settings";

describe("feedbackSources", () => {
  test("has exactly the 5 values", () => {
    expect([...feedbackSources]).toEqual(["cli", "telegram", "undo", "imap_move", "web"]);
  });
});

describe("parseToolSwitches", () => {
  test("{} gives all switches off", () => {
    expect(parseToolSwitches({})).toEqual({
      move: false,
      mark_read: false,
      flag: false,
      create_draft: false,
      move_unsure: false,
    });
  });

  test("drops an unknown key", () => {
    const parsed = parseToolSwitches({ move: true, bogus: true });
    expect(parsed.move).toBe(true);
    expect("bogus" in parsed).toBe(false);
  });

  test("throws on a bad value", () => {
    expect(() => parseToolSwitches({ move: "yes" })).toThrow();
  });
});

describe("category policy", () => {
  test("thresholdFor and autoFor use defaults for a missing category", () => {
    expect(thresholdFor({}, "info")).toBe(0.7);
    expect(autoFor({}, "info")).toBe(false);
  });

  test("reads values from the policy", () => {
    const policy = parseCategoryPolicy({ spam: { auto: true, threshold: 0.9 }, info: {} });
    expect(thresholdFor(policy, "spam")).toBe(0.9);
    expect(autoFor(policy, "spam")).toBe(true);
    expect(thresholdFor(policy, "info")).toBe(0.7);
  });

  test("throws on a threshold of 1.5", () => {
    expect(() => parseCategoryPolicy({ spam: { threshold: 1.5 } })).toThrow();
  });
});
