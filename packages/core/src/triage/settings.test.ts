import { describe, expect, test } from "bun:test";

import type { EvidenceKey } from "../trust/key";

import { feedbackSources } from "./categories";
import { autoFor, effectiveAutoFor, parseCategoryPolicy, parseToolSwitches, thresholdFor } from "./settings";

describe("feedbackSources", () => {
  test("has exactly the 7 values", () => {
    expect([...feedbackSources]).toEqual(["cli", "telegram", "undo", "imap_move", "web", "review", "answered_check"]);
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

const KEY_A: EvidenceKey = {
  provider: "gemini",
  model: "gemini-3.5-flash-lite",
  reasoningEffort: null,
  promptVersion: "classifier-v2",
  promptParts: null,
  endpoint: "standard",
  host: null,
};
const grantOf = (key: EvidenceKey) => ({ key, by: "evidence", at: "2026-11-10T10:00:00.000Z" });

describe("effectiveAutoFor (ADR 0028)", () => {
  test("auto with a grant on the running key: true", () => {
    const policy = parseCategoryPolicy({ notification: { auto: true, grant: grantOf(KEY_A) } });
    expect(effectiveAutoFor(policy, "notification", { ...KEY_A, promptParts: [] })).toBe(true);
  });

  test("auto with a grant on another key: false, whichever field differs", () => {
    const policy = parseCategoryPolicy({ notification: { auto: true, grant: grantOf(KEY_A) } });
    for (const other of [
      { ...KEY_A, model: "gemini-4" },
      { ...KEY_A, provider: "openai" },
      { ...KEY_A, reasoningEffort: "low" },
      { ...KEY_A, promptVersion: "classifier-v3" },
      { ...KEY_A, promptParts: ["x"] },
      { ...KEY_A, endpoint: "eu" as const },
    ]) {
      expect(effectiveAutoFor(policy, "notification", other)).toBe(false);
    }
  });

  test("only the endpoint differs: false (the data region changed)", () => {
    const policy = parseCategoryPolicy({ spam: { auto: true, grant: grantOf(KEY_A) } });
    expect(effectiveAutoFor(policy, "spam", { ...KEY_A, endpoint: "eu" })).toBe(false);
  });

  test("auto with no grant (a row from before F110): true", () => {
    const policy = parseCategoryPolicy({ info: { auto: true, threshold: 0.8 } });
    expect(effectiveAutoFor(policy, "info", KEY_A)).toBe(true);
  });

  test("auto off or no entry: false, with or without a matching grant", () => {
    const policy = parseCategoryPolicy({ info: { auto: false, grant: grantOf(KEY_A) } });
    expect(effectiveAutoFor(policy, "info", KEY_A)).toBe(false);
    expect(effectiveAutoFor({}, "spam", KEY_A)).toBe(false);
  });

  test("a stored grant of another shape is a parse error, not a match", () => {
    expect(() => parseCategoryPolicy({ info: { auto: true, grant: { by: "evidence", at: "x" } } })).toThrow();
    expect(() => parseCategoryPolicy({ info: { auto: true, grant: { ...grantOf(KEY_A), by: "nobody" } } })).toThrow();
  });
});
