import { describe, expect, test } from "bun:test";

import { senderLineSchema, suggestionItemSchema } from "./sender-context";

describe("senderLineSchema", () => {
  const line = { relation: "known", received: 12, answered: 4, userMailsTo: 2, lastSeenDaysAgo: 3, days: 90 };

  test("accepts counts and a null last-seen", () => {
    expect(senderLineSchema.parse(line)).toEqual(line);
    expect(senderLineSchema.parse({ ...line, lastSeenDaysAgo: null }).lastSeenDaysAgo).toBeNull();
  });

  test("rejects a text field and a window other than 90 days", () => {
    expect(senderLineSchema.safeParse({ ...line, name: "Jan" }).success).toBe(false);
    expect(senderLineSchema.safeParse({ ...line, days: 30 }).success).toBe(false);
  });
});

describe("suggestionItemSchema", () => {
  const item = {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "blocklist",
    scope: "domain",
    pattern: "@acme.pl",
    reason: { corrected: 4, senders: 2 },
    createdAt: "2026-11-18T10:00:00.000Z",
  };

  test("accepts an open suggestion", () => {
    expect(suggestionItemSchema.parse(item)).toEqual(item);
  });

  test("rejects a reason with a text key and an unknown kind", () => {
    expect(suggestionItemSchema.safeParse({ ...item, reason: { subject: "Hi" } }).success).toBe(false);
    expect(suggestionItemSchema.safeParse({ ...item, kind: "delete" }).success).toBe(false);
  });
});
