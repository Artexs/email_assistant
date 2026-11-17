import { describe, expect, test } from "bun:test";

import {
  delegateMailBodySchema,
  loopActionBodySchema,
  loopFollowUpAnswerSchema,
  loopListQuerySchema,
  loopWaitBodySchema,
} from "./loops";

describe("loopListQuerySchema", () => {
  test("the kind is required and must be a known kind", () => {
    expect(loopListQuerySchema.safeParse({}).success).toBe(false);
    expect(loopListQuerySchema.safeParse({ kind: "other" }).success).toBe(false);
    for (const kind of ["waiting", "promised", "delegated"]) {
      expect(loopListQuerySchema.safeParse({ kind }).success).toBe(true);
    }
  });

  test("the filter is open, due or closed; the limit is 1 to 100 and comes from text", () => {
    expect(loopListQuerySchema.safeParse({ kind: "waiting", filter: "all" }).success).toBe(false);
    for (const filter of ["open", "due", "closed"]) {
      expect(loopListQuerySchema.safeParse({ kind: "waiting", filter }).success).toBe(true);
    }
    expect(loopListQuerySchema.parse({ kind: "waiting", limit: "100" }).limit).toBe(100);
    for (const limit of ["0", "101", "1.5", "x"]) {
      expect(loopListQuerySchema.safeParse({ kind: "waiting", limit }).success).toBe(false);
    }
  });
});

describe("the bodies", () => {
  test("a loop action takes an empty object only", () => {
    expect(loopActionBodySchema.safeParse({}).success).toBe(true);
    expect(loopActionBodySchema.safeParse({ x: 1 }).success).toBe(false);
  });

  test("the wait is a whole number from 1 to 10 and nothing else", () => {
    for (const days of [1, 5, 10]) expect(loopWaitBodySchema.safeParse({ days }).success).toBe(true);
    for (const days of [0, 11, 2.5, "5", null]) expect(loopWaitBodySchema.safeParse({ days }).success).toBe(false);
    expect(loopWaitBodySchema.safeParse({ days: 5, more: 1 }).success).toBe(false);
  });

  test("the delegate body needs a UUID", () => {
    expect(delegateMailBodySchema.safeParse({ delegateId: "x" }).success).toBe(false);
    expect(delegateMailBodySchema.safeParse({ delegateId: "11111111-1111-4111-8111-111111111111" }).success).toBe(true);
  });
});

describe("loopFollowUpAnswerSchema", () => {
  test("planned carries the send id; would_draft carries nothing", () => {
    const sendId = "11111111-1111-4111-8111-111111111111";
    expect(loopFollowUpAnswerSchema.safeParse({ status: "planned", sendId }).success).toBe(true);
    expect(loopFollowUpAnswerSchema.safeParse({ status: "planned" }).success).toBe(false);
    expect(loopFollowUpAnswerSchema.safeParse({ status: "would_draft" }).success).toBe(true);
    expect(loopFollowUpAnswerSchema.safeParse({ status: "would_draft", sendId }).success).toBe(false);
  });
});
