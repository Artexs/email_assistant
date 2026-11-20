import { describe, expect, test } from "bun:test";

import type { EvidenceKey } from "../trust/key";

import { feedbackSources } from "./categories";
import {
  autoFor,
  describeSettings,
  effectiveAutoFor,
  parseCategoryPolicy,
  parseToolSwitches,
  thresholdFor,
} from "./settings";

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
      auto_follow_up: false,
      reply_drafts: false,
    });
  });

  test("keeps the open-loops switch through a parse; only a JSON true is on, a bad value is off and fails nothing else", () => {
    expect(parseToolSwitches({ auto_follow_up: true }).auto_follow_up).toBe(true);
    for (const value of ["true", 1, "yes", null, { on: true }, [true], 0]) {
      expect(parseToolSwitches({ move: true, auto_follow_up: value })).toMatchObject({
        move: true,
        auto_follow_up: false,
      });
    }
  });

  test("keeps the reply-drafts switch through a parse; only a JSON true is on, a bad value is off and fails nothing else", () => {
    expect(parseToolSwitches({}).reply_drafts).toBe(false);
    expect(parseToolSwitches({ reply_drafts: true }).reply_drafts).toBe(true);
    for (const value of ["true", 1, "yes", null, { on: true }, [true], 0]) {
      expect(parseToolSwitches({ move: true, reply_drafts: value })).toMatchObject({ move: true, reply_drafts: false });
    }
    // It is independent of the draft switch.
    expect(parseToolSwitches({ reply_drafts: true }).create_draft).toBe(false);
    expect(parseToolSwitches({ create_draft: true }).reply_drafts).toBe(false);
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

  // `at` is the `granted_at` of a trip: a text that is not an ISO instant must not reach it.
  test("a grant whose time is not an ISO instant is a parse error", () => {
    for (const at of ["yesterday", "2026-11-10", "2026-11-10 10:00:00", ""]) {
      expect(() => parseCategoryPolicy({ info: { auto: true, grant: { ...grantOf(KEY_A), at } } })).toThrow();
    }
    expect(() => parseCategoryPolicy({ info: { auto: true, grant: grantOf(KEY_A) } })).not.toThrow();
  });
});

describe("describeSettings", () => {
  test("default settings: every switch and every category is off, the threshold is 0.7", () => {
    expect(
      describeSettings({
        mode: "shadow",
        toolSwitches: parseToolSwitches({}),
        categoryPolicy: {},
        movesSupported: false,
      })
    ).toEqual([
      "mode: shadow",
      "switch move: off",
      "switch mark_read: off",
      "switch flag: off",
      "switch create_draft: off",
      "switch move_unsure: off",
      "switch reply_drafts: off",
      "auto urgent: off, threshold 0.7",
      "auto needs_reply: off, threshold 0.7",
      "auto info: off, threshold 0.7",
      "auto notification: off, threshold 0.7",
      "auto spam: off, threshold 0.7",
      "moves supported: off",
    ]);
  });

  test("every option set: the lines show each value, in the order of the switch names and the categories", () => {
    expect(
      describeSettings({
        mode: "assist",
        toolSwitches: parseToolSwitches({
          move: true,
          mark_read: true,
          flag: true,
          create_draft: true,
          move_unsure: true,
          auto_follow_up: true,
          reply_drafts: true,
        }),
        categoryPolicy: parseCategoryPolicy({
          urgent: { auto: true, threshold: 0.95 },
          needs_reply: { auto: true, threshold: 0.8 },
          info: { auto: true, threshold: 0 },
          notification: { auto: true, threshold: 1 },
          spam: { auto: true, threshold: 0.55 },
        }),
        movesSupported: true,
      })
    ).toEqual([
      "mode: assist",
      "switch move: on",
      "switch mark_read: on",
      "switch flag: on",
      "switch create_draft: on",
      "switch move_unsure: on",
      "switch reply_drafts: on",
      "auto urgent: on, threshold 0.95",
      "auto needs_reply: on, threshold 0.8",
      "auto info: on, threshold 0",
      "auto notification: on, threshold 1",
      "auto spam: on, threshold 0.55",
      "moves supported: on",
    ]);
  });

  test("a mixed state: one switch on, one category on, another category with a threshold and auto off", () => {
    const lines = describeSettings({
      mode: "assist",
      toolSwitches: parseToolSwitches({ flag: true }),
      categoryPolicy: parseCategoryPolicy({ spam: { auto: true }, info: { threshold: 0.9 } }),
      movesSupported: true,
    });
    expect(lines).toContain("switch flag: on");
    expect(lines).toContain("switch move: off");
    expect(lines).toContain("auto spam: on, threshold 0.7");
    expect(lines).toContain("auto info: off, threshold 0.9");
    expect(lines).toContain("moves supported: on");
    expect(lines).toHaveLength(13);
  });
});
