// Every draft kind is complete. A new kind starts in draftKinds (payloads.ts); docs/code-patterns.md has the checklist.
import { describe, expect, test } from "bun:test";

import { DRAFT_TEMPLATES } from "../outgoing/templates";

import { draftKinds, draftPayloadSchema, sendPayloadSchema } from "./payloads";

const LOOP_ID = "11111111-1111-4111-8111-111111111111";
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

describe("every draft kind is complete", () => {
  test("the draft payload union has one member per kind", () => {
    expect(sorted(draftPayloadSchema.options.map((option) => option.shape.kind.value))).toEqual(sorted(draftKinds));
  });

  test("the send payload accepts each kind and no other", () => {
    for (const kind of draftKinds) {
      const extra = kind === "follow_up" ? { loop_id: LOOP_ID } : {};
      expect(sendPayloadSchema.safeParse({ kind, to: ["a@example.com"], ...extra }).success).toBe(true);
    }
    expect(sendPayloadSchema.safeParse({ kind: "other", to: ["a@example.com"] }).success).toBe(false);
  });

  test("only a follow-up has more than one recipient, a Cc or a loop", () => {
    const to = ["a@example.com", "b@example.com"];
    expect(sendPayloadSchema.safeParse({ kind: "delegation", to }).success).toBe(false);
    expect(sendPayloadSchema.safeParse({ kind: "clarification", to: [to[0]], cc: ["b@example.com"] }).success).toBe(
      false
    );
    expect(
      sendPayloadSchema.safeParse({ kind: "follow_up", to, cc: ["c@example.com"], loop_id: LOOP_ID }).success
    ).toBe(true);
    expect(sendPayloadSchema.safeParse({ kind: "follow_up", to }).success).toBe(false);
    expect(sendPayloadSchema.safeParse({ kind: "follow_up", to: [], loop_id: LOOP_ID }).success).toBe(false);
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
      subject: "S1",
      followUpNumber: 1 as const,
      signature: "Sig",
    };
    for (const kind of draftKinds) {
      const text = DRAFT_TEMPLATES[kind](false, fields);
      expect(text.endsWith("Sig")).toBe(true);
      expect(text).toContain(kind === "clarification" ? "Q1" : kind === "follow_up" ? "S1" : "T1");
    }
  });
});
