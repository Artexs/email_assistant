import { describe, expect, test } from "bun:test";

import { type HistoryOutcome, historyOutcome } from "./history";
import { sameKey, type EvidenceKey } from "./key";

describe("historyOutcome", () => {
  test("under 50 acted-on mails is no_result with no bound", () => {
    expect(historyOutcome({ acted: 49, moved: 0 })).toEqual({ outcome: "no_result", upper: null });
  });
  test("50 acted-on, none moved is inconclusive (upper about 0.0713)", () => {
    const result = historyOutcome({ acted: 50, moved: 0 });
    expect(result.outcome).toBe("inconclusive");
    expect(result.upper).toBeCloseTo(0.0713, 3);
  });
  test("189 acted-on, none moved passes", () => {
    const result = historyOutcome({ acted: 189, moved: 0 });
    expect(result.outcome).toBe("pass");
    expect(result.upper as number).toBeLessThanOrEqual(0.02);
  });
  test.each<[string, { acted: number; moved: number }, HistoryOutcome]>([
    ["188 acted-on, none moved is inconclusive", { acted: 188, moved: 0 }, "inconclusive"],
    ["a moved share of 0.03 fails", { acted: 100, moved: 3 }, "fail"],
    ["a moved share of 0.02 is not over 0.02: inconclusive", { acted: 100, moved: 2 }, "inconclusive"],
  ])("%s", (_name, counts, outcome) => {
    expect(historyOutcome(counts).outcome).toBe(outcome);
  });
});

const base: EvidenceKey = {
  provider: "openai",
  model: "m",
  reasoningEffort: null,
  promptVersion: "v2",
  promptParts: null,
  endpoint: "standard",
  host: null,
};

describe("sameKey", () => {
  test("equal keys match", () => {
    expect(sameKey(base, { ...base })).toBe(true);
  });
  test.each([
    ["endpoint", { endpoint: "eu" as const }],
    ["reasoningEffort", { reasoningEffort: "none" }],
    ["promptParts", { promptParts: ["folder_hint"] }],
    ["provider", { provider: "gemini" }],
    ["model", { model: "n" }],
    ["promptVersion", { promptVersion: "v3" }],
  ])("a difference in %s only is a different key", (_name, change) => {
    expect(sameKey(base, { ...base, ...change })).toBe(false);
  });
  test("prompt parts compare as a set", () => {
    expect(sameKey({ ...base, promptParts: ["a", "b"] }, { ...base, promptParts: ["b", "a"] })).toBe(true);
  });
  test("no prompt parts (null) equals an empty list", () => {
    expect(sameKey(base, { ...base, promptParts: [] })).toBe(true);
  });
  test("two own keys with different hosts differ", () => {
    expect(sameKey({ ...base, endpoint: "own", host: "llm-a" }, { ...base, endpoint: "own", host: "llm-b" })).toBe(
      false
    );
  });
  test("two standard keys ignore the host", () => {
    expect(sameKey(base, { ...base, host: "api.openai.com" })).toBe(true);
  });
});
