import { describe, expect, test } from "bun:test";

import {
  activityItemSchema,
  type ActivityItem,
  activityQuerySchema,
  activityRangeMs,
  feedbackBodySchema,
  undoResultSchema,
} from "./activity";

const UUID = "0b9d2f6e-4c1a-4f7e-9a3b-1d2e3f4a5b6c";
const UUID2 = "1c0e3a7f-5d2b-4a8f-8b4c-2e3f4a5b6c7d";

describe("activityQuerySchema", () => {
  test("empty query leaves every field undefined", () => {
    expect(activityQuerySchema.parse({})).toEqual({});
  });

  test("categories is a comma list of unique categories", () => {
    expect(activityQuerySchema.parse({ categories: "urgent,needs_reply" }).categories).toEqual([
      "urgent",
      "needs_reply",
    ]);
    expect(activityQuerySchema.safeParse({ categories: "info," }).success).toBe(false);
    expect(activityQuerySchema.safeParse({ categories: "info,info" }).success).toBe(false);
    expect(activityQuerySchema.safeParse({ categories: "bogus" }).success).toBe(false);
    const eight = "urgent,needs_reply,delegation,info,notification,spam,unsure,urgent";
    expect(activityQuerySchema.safeParse({ categories: eight }).success).toBe(false);
  });

  test("limit is an integer from 1 to 100", () => {
    expect(activityQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    for (const limit of ["0", "101", "1.5"]) {
      expect(activityQuerySchema.safeParse({ limit }).success).toBe(false);
    }
  });

  test("since, notRated, before and unknown keys", () => {
    expect(activityQuerySchema.safeParse({ since: "2026-11-11T10:00:00.000Z" }).success).toBe(true);
    expect(activityQuerySchema.safeParse({ since: "yesterday" }).success).toBe(false);
    expect(activityQuerySchema.safeParse({ notRated: "true" }).success).toBe(true);
    expect(activityQuerySchema.safeParse({ notRated: "yes" }).success).toBe(false);
    expect(activityQuerySchema.safeParse({ before: "" }).success).toBe(false);
    expect(activityQuerySchema.safeParse({ extra: "1" }).success).toBe(true);
  });
});

describe("feedbackBodySchema", () => {
  test("accepts the five label categories only", () => {
    expect(feedbackBodySchema.safeParse({ emailId: UUID, trueCategory: "info" }).success).toBe(true);
    expect(feedbackBodySchema.safeParse({ emailId: UUID, trueCategory: "unsure" }).success).toBe(false);
    expect(feedbackBodySchema.safeParse({ emailId: UUID, trueCategory: "delegation" }).success).toBe(false);
    expect(feedbackBodySchema.safeParse({ emailId: "nope", trueCategory: "info" }).success).toBe(false);
  });
});

describe("activityItemSchema", () => {
  const full: ActivityItem = {
    emailId: UUID,
    mailboxId: UUID2,
    receivedAt: "2026-11-11T09:00:00.000Z",
    triagedAt: "2026-11-11T09:01:00.000Z",
    from: "Anna <anna@example.com>",
    subject: "Hello",
    category: "notification",
    confidence: 0.93,
    modelCategory: null,
    aiText: "Automated shipping update.",
    phrase: "done: move to AI/Notifications",
    actions: [
      {
        type: "move",
        status: "applied",
        phrase: "done: move to AI/Notifications",
        appliedAt: "2026-11-11T09:02:00.000Z",
      },
    ],
    undoable: true,
    undoPending: false,
    feedback: { verdict: "right", trueCategory: "notification", source: "web", at: "2026-11-11T09:05:00.000Z" },
    delegation: { delegateName: "Ola", status: "drafted", dueAt: "2026-11-13T09:00:00.000Z" },
  };

  test("parses a full item", () => {
    expect(activityItemSchema.parse(full)).toEqual(full);
  });

  test("parses an item with null fields", () => {
    const item = { ...full, feedback: null, delegation: null, from: null, subject: null };
    expect(activityItemSchema.parse(item)).toEqual(item);
  });

  test("range table in ms", () => {
    expect(activityRangeMs["7d"]).toBe(604800000);
    expect(activityRangeMs["24h"]).toBe(86400000);
  });
});

describe("undoResultSchema", () => {
  test("kinds", () => {
    expect(undoResultSchema.parse({ kind: "started", created: 2 })).toEqual({ kind: "started", created: 2 });
    expect(undoResultSchema.safeParse({ kind: "not_found" }).success).toBe(false);
  });
});
