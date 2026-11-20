import { describe, expect, test } from "bun:test";

import { approvalItemSchema } from "./approvals";
import {
  cleanReplyInstruction,
  REPLY_INSTRUCTION_RAW_MAX,
  replyConflictSchema,
  replyRecipientsBodySchema,
  replyRedraftBodySchema,
  replyRequestBodySchema,
  replyRequestStatusSchema,
} from "./replies";

const ID = "00000000-0000-4000-8000-000000000001";

describe("the bodies of the reply routes are strict and capped", () => {
  test("the raw limit of the instruction is 1000 characters (the service cleans and caps it at 300)", () => {
    expect(REPLY_INSTRUCTION_RAW_MAX).toBe(1000);
  });

  test("a request takes an id and an optional line, nothing else", () => {
    expect(replyRequestBodySchema.safeParse({ emailId: ID }).success).toBe(true);
    expect(
      replyRequestBodySchema.safeParse({ emailId: ID, instruction: "x".repeat(REPLY_INSTRUCTION_RAW_MAX) }).success
    ).toBe(true);
    for (const bad of [
      {},
      { emailId: "nope" },
      { emailId: ID, instruction: "x".repeat(REPLY_INSTRUCTION_RAW_MAX + 1) },
      { emailId: ID, instruction: null },
      { emailId: ID, to: ["a@x.test"] },
    ]) {
      expect(replyRequestBodySchema.safeParse(bad).success).toBe(false);
    }
  });

  test("a redraft needs its line; a recipients change takes a mode and no address", () => {
    expect(replyRedraftBodySchema.safeParse({ instruction: "shorter" }).success).toBe(true);
    expect(replyRedraftBodySchema.safeParse({}).success).toBe(false);
    expect(replyRedraftBodySchema.safeParse({ instruction: "x".repeat(REPLY_INSTRUCTION_RAW_MAX + 1) }).success).toBe(
      false
    );
    for (const mode of ["from", "reply_to", "all"])
      expect(replyRecipientsBodySchema.safeParse({ mode }).success).toBe(true);
    for (const bad of [{ mode: "everyone" }, { mode: "all", to: ["a@x.test"] }, {}, { to: ["a@x.test"] }]) {
      expect(replyRecipientsBodySchema.safeParse(bad).success).toBe(false);
    }
  });

  test("the answers carry no instruction: the status and the conflict schemas refuse an extra key", () => {
    expect(replyRequestStatusSchema.safeParse({ status: "done", reasonCode: null, sendId: ID }).success).toBe(true);
    expect(
      replyRequestStatusSchema.safeParse({ status: "done", reasonCode: null, sendId: ID, instruction: "x" }).success
    ).toBe(false);
    expect(replyConflictSchema.safeParse({ error: "blocked", reason: "suspicious" }).success).toBe(true);
    expect(replyConflictSchema.safeParse({ error: "blocked", reason: "suspicious", instruction: "x" }).success).toBe(
      false
    );
    expect(replyConflictSchema.safeParse({ error: "blocked", reason: "not a reason" }).success).toBe(false);
  });
});

describe("the reply fields of an approval item", () => {
  test("redraftsLeft is 0 to 5 and the mode is one of the three; a key outside the schema is refused", () => {
    const base = {
      id: ID,
      mailboxAddress: "a@x.test",
      createdAt: "2026-11-18T10:00:00.000Z",
      delegationId: null,
      setId: null,
      version: 1,
      state: "waiting" as const,
      draftReady: true,
      kind: "reply" as const,
      expiresAt: "2026-11-25T10:00:00.000Z",
      heldBy: null,
      view: {
        kind: "reply" as const,
        recipient: { name: null, address: "a@x.test" },
        sender: null,
        recipientInactive: false,
        subject: "s",
        dueDate: null,
        body: "b",
        quote: null,
        synthetic: false,
      },
    };
    expect(
      approvalItemSchema.safeParse({ ...base, instruction: null, redraftsLeft: 5, recipientsMode: "all" }).success
    ).toBe(true);
    expect(approvalItemSchema.safeParse(base).success).toBe(true);
    for (const bad of [
      { redraftsLeft: 6 },
      { redraftsLeft: -1 },
      { recipientsMode: "x" },
      { instruction: "x".repeat(301) },
      { extra: 1 },
    ]) {
      expect(approvalItemSchema.safeParse({ ...base, ...bad }).success).toBe(false);
    }
  });
});

describe("cleanReplyInstruction", () => {
  test.each([
    ["trims the ends", "  Odpisz uprzejmie  ", "Odpisz uprzejmie"],
    ["joins two lines into one", "Pierwsza\r\nDruga", "Pierwsza Druga"],
    ["drops a direction mark and a control character", "Od\u200episz\u0007 tak", "Odpisz tak"],
  ])("%s", (_name, input, expected) => {
    expect(cleanReplyInstruction(input)).toBe(expected);
  });

  test.each([
    ["an empty line", ""],
    ["only blanks", "   \n  "],
    ["only a direction mark", "\u200e"],
    ["301 characters", "a".repeat(301)],
    ["301 emoji", "😀".repeat(301)],
  ])("%s is null", (_name, input) => {
    expect(cleanReplyInstruction(input)).toBeNull();
  });

  test.each([
    ["one character", "a"],
    ["300 characters", "a".repeat(300)],
    ["300 emoji (the length counts code points)", "😀".repeat(300)],
  ])("%s is kept", (_name, input) => {
    expect(cleanReplyInstruction(input)).toBe(input);
  });
});
