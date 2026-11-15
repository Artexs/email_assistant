import { describe, expect, test } from "bun:test";

import { type EscalationSignals, escalationRecord, shouldEscalate } from "./escalation";

const person: EscalationSignals = {
  finalCategory: "spam",
  reasonCode: "marketing",
  noreply: false,
  isList: false,
  autoSubmitted: null,
  precedence: null,
};

describe("shouldEscalate", () => {
  const cases: [string, Partial<EscalationSignals>, boolean][] = [
    ["spam from a person", {}, true],
    ["info from a person", { finalCategory: "info" }, true],
    ["notification from a person", { finalCategory: "notification" }, true],
    ["spam from list mail", { isList: true }, false],
    ["spam from a noreply sender", { noreply: true }, false],
    ["notification auto-generated", { finalCategory: "notification", autoSubmitted: "auto-generated" }, false],
    ["Auto-Submitted no is a person", { autoSubmitted: "no" }, true],
    ["urgent", { finalCategory: "urgent" }, false],
    ["needs_reply", { finalCategory: "needs_reply" }, false],
    ["delegation", { finalCategory: "delegation" }, false],
    [
      "unsure from the threshold with list mail",
      { finalCategory: "unsure", reasonCode: "below_threshold", isList: true },
      true,
    ],
    ["unsure from the model", { finalCategory: "unsure", reasonCode: "other" }, true],
    ["triage_error", { finalCategory: "unsure", reasonCode: "triage_error" }, false],
    ["llm_blocked", { finalCategory: "unsure", reasonCode: "llm_blocked" }, false],
    ["blocklist", { reasonCode: "blocklist" }, false],
    ["precedence bulk", { precedence: "bulk" }, false],
    ["precedence list", { precedence: "list" }, false],
    ["precedence junk, any case", { precedence: " Junk " }, false],
    ["another precedence value", { precedence: "first-class" }, true],
  ];
  test.each(cases)("%s", (_name, patch, expected) => {
    expect(shouldEscalate({ ...person, ...patch })).toBe(expected);
  });
});

describe("escalationRecord", () => {
  test("keeps the category, confidence, model and prompt version of the first answer", () => {
    expect(
      escalationRecord({ category: "spam", confidence: 0.91, model: "gpt-6-luna", promptVersion: "classifier-v2" })
    ).toEqual({
      fromCategory: "spam",
      fromConfidence: 0.91,
      fromModel: "gpt-6-luna",
      fromPromptVersion: "classifier-v2",
    });
  });
});
