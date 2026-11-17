// Every draft kind is complete. A new kind starts in draftKinds (payloads.ts); docs/code-patterns.md has the checklist.
import { describe, expect, test } from "bun:test";

import { DRAFT_TEMPLATES, NO_TEMPLATE } from "../outgoing/templates";

import { draftKinds, draftPayloadSchema, REPLY_CC_MAX, replyRecipientsProblem, sendPayloadSchema } from "./payloads";

const LOOP_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const reply = (over: Record<string, unknown> = {}) => ({
  kind: "reply",
  to: ["a@example.com"],
  cc: [],
  language: "en",
  body: "Thanks, I will check.",
  request_id: REQUEST_ID,
  folder: "INBOX",
  recipients: "from",
  ...over,
});
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

  test("only a follow-up or a reply has a Cc; only a follow-up has more than one To or a loop", () => {
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
    // A follow-up send with 10 To still parses (the rule of the loop row).
    const ten = Array.from({ length: 10 }, (_, i) => `u${i}@example.com`);
    expect(sendPayloadSchema.safeParse({ kind: "follow_up", to: ten, loop_id: LOOP_ID }).success).toBe(true);
    // The Cc of a follow-up stays at 9 (the loop row); only a reply may have 10.
    const nine = ten.slice(0, 9);
    const cc10 = [...nine, "z9@example.com"];
    expect(
      sendPayloadSchema.safeParse({ kind: "follow_up", to: ["a@example.com"], cc: nine, loop_id: LOOP_ID }).success
    ).toBe(true);
    expect(
      sendPayloadSchema.safeParse({ kind: "follow_up", to: ["a@example.com"], cc: cc10, loop_id: LOOP_ID }).success
    ).toBe(false);
  });

  test("a reply send has one To and 0 to 10 Cc", () => {
    const cc = (count: number) => Array.from({ length: count }, (_, i) => `c${i}@example.com`);
    expect(sendPayloadSchema.safeParse({ kind: "reply", to: ["a@example.com"], cc: cc(10) }).success).toBe(true);
    expect(sendPayloadSchema.safeParse({ kind: "reply", to: ["a@example.com"] }).success).toBe(true);
    expect(sendPayloadSchema.safeParse({ kind: "reply", to: ["a@example.com"], cc: cc(11) }).success).toBe(false);
    expect(sendPayloadSchema.safeParse({ kind: "reply", to: ["a@example.com", "b@example.com"] }).success).toBe(false);
    expect(sendPayloadSchema.safeParse({ kind: "reply", to: [] }).success).toBe(false);
    // The other kinds still refuse a Cc, even an empty one.
    expect(sendPayloadSchema.safeParse({ kind: "delegation", to: ["a@example.com"], cc: [] }).success).toBe(false);
  });

  test("a reply draft: 11 Cc fail the schema, 10 pass, To is exactly one address", () => {
    const cc = (count: number) => Array.from({ length: count }, (_, i) => `c${i}@example.com`);
    expect(draftPayloadSchema.safeParse(reply({ cc: cc(REPLY_CC_MAX) })).success).toBe(true);
    expect(draftPayloadSchema.safeParse(reply({ cc: cc(REPLY_CC_MAX + 1) })).success).toBe(false);
    expect(draftPayloadSchema.safeParse(reply({ to: ["a@example.com", "b@example.com"] })).success).toBe(false);
    expect(draftPayloadSchema.safeParse(reply({ to: [] })).success).toBe(false);
    expect(draftPayloadSchema.safeParse(reply({ recipients: "everyone" })).success).toBe(false);
    expect(draftPayloadSchema.safeParse(reply({ request_id: "x" })).success).toBe(false);
    expect(draftPayloadSchema.safeParse(reply({ body: "" })).success).toBe(false);
  });

  test("replyRecipientsProblem: Cc equal to To, a twin in Cc, an own mailbox in Cc", () => {
    const own = ["Box@Example.com"];
    expect(replyRecipientsProblem({ to: ["a@example.com"], cc: ["b@example.com"] }, own)).toBeNull();
    expect(replyRecipientsProblem({ to: ["a@example.com"], cc: [] }, own)).toBeNull();
    expect(replyRecipientsProblem({ to: ["a@example.com"], cc: ["A@example.com"] }, own)).toBe("cc_is_to");
    expect(replyRecipientsProblem({ to: ["a@example.com"], cc: ["b@example.com", "B@example.com"] }, own)).toBe(
      "cc_duplicate"
    );
    expect(replyRecipientsProblem({ to: ["a@example.com"], cc: ["box@example.com"] }, own)).toBe("cc_own_mailbox");
  });

  test("each kind has a template or a reason for none, never both", () => {
    const templated = Object.keys(DRAFT_TEMPLATES);
    const none = Object.keys(NO_TEMPLATE);
    expect(sorted([...templated, ...none])).toEqual(sorted(draftKinds));
    expect(templated.filter((kind) => none.includes(kind))).toEqual([]);
    for (const reason of Object.values(NO_TEMPLATE)) expect(reason.length).toBeGreaterThan(20);
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
    for (const kind of Object.keys(DRAFT_TEMPLATES) as (keyof typeof DRAFT_TEMPLATES)[]) {
      const text = DRAFT_TEMPLATES[kind](false, fields);
      expect(text.endsWith("Sig")).toBe(true);
      expect(text).toContain(kind === "clarification" ? "Q1" : kind === "follow_up" ? "S1" : "T1");
    }
  });
});
