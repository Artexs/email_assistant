import { describe, expect, test } from "bun:test";

import { en } from "../i18n/en";
import { pl } from "../i18n/pl";
import { sentenceParts, type RuleSlot } from "./rule-sentence";

const slotsOf = (template: string): RuleSlot[] =>
  sentenceParts(template).flatMap((part) => (part.kind === "slot" ? [part.slot] : []));

describe("sentenceParts", () => {
  test.each([
    ["en", en.rules_sentence, ["pattern", "kind", "scope"]],
    ["pl", pl.rules_sentence, ["pattern", "scope", "kind"]],
  ] as const)("the %s sentence has its own slot order", (_locale, template, order) => {
    expect(slotsOf(template)).toEqual([...order]);
  });

  test.each([
    ["en", en.rules_sentence],
    ["pl", pl.rules_sentence],
  ])("the %s sentence starts with text and keeps its spaces", (_locale, template) => {
    const parts = sentenceParts(template);
    expect(parts[0]?.kind).toBe("text");
    expect(parts.map((part) => (part.kind === "text" ? part.text : `{${part.slot}}`)).join("")).toBe(template);
  });

  test("splits text and slots and drops empty text", () => {
    expect(sentenceParts("{kind}{pattern} to {scope}")).toEqual([
      { kind: "slot", slot: "kind" },
      { kind: "slot", slot: "pattern" },
      { kind: "text", text: " to " },
      { kind: "slot", slot: "scope" },
    ]);
  });

  test.each([
    ["Treat {pattern} as {kind}", "Slot {scope} is missing in the rule sentence"],
    ["{pattern} {pattern} {kind} {scope}", "Slot {pattern} repeats in the rule sentence"],
    ["{who} {pattern} {kind} {scope}", "Unknown slot {who} in the rule sentence"],
  ])("throws for %p", (template, message) => {
    expect(() => sentenceParts(template)).toThrow(message);
  });
});
