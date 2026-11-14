// Every draft kind is complete. A new kind starts in draftKinds (payloads.ts); docs/code-patterns.md has the checklist.
import { describe, expect, test } from "bun:test";

import { DRAFT_TEMPLATES } from "../outgoing/templates";

import { draftKinds, draftPayloadSchema, sendPayloadSchema } from "./payloads";

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

describe("every draft kind is complete", () => {
  test("the draft payload union has one member per kind", () => {
    expect(sorted(draftPayloadSchema.options.map((option) => option.shape.kind.value))).toEqual(sorted(draftKinds));
  });

  test("the send payload accepts each kind and no other", () => {
    for (const kind of draftKinds) {
      expect(sendPayloadSchema.safeParse({ kind, to: ["a@example.com"] }).success).toBe(true);
    }
    expect(sendPayloadSchema.safeParse({ kind: "follow_up", to: ["a@example.com"] }).success).toBe(false);
  });

  test("each kind has a template", () => {
    expect(sorted(Object.keys(DRAFT_TEMPLATES))).toEqual(sorted(draftKinds));
  });

  test("each template fills its fields", () => {
    const fields = {
      task: "T1",
      question: "Q1",
      dueDate: null,
      senderLabel: "s@example.com",
      dateLabel: "Fri 6 Nov",
      signature: "Sig",
    };
    for (const kind of draftKinds) {
      const text = DRAFT_TEMPLATES[kind](false, fields);
      expect(text.endsWith("Sig")).toBe(true);
      expect(text).toContain(kind === "clarification" ? "Q1" : "T1");
    }
  });
});
