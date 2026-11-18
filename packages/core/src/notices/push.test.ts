import { describe, expect, test } from "bun:test";

import { noticeKinds } from "./kinds";
import {
  noticeGroupNames,
  noticeGroupOf,
  noticeGroups,
  noticePath,
  pushKinds,
  pushPayloadKinds,
  pushPayloadSchema,
  type PushPayload,
} from "./push";

const ID = "3f1c2a52-0b6e-4c1a-9d0e-5a7b8c9d0e1f";

describe("noticePath", () => {
  test("1. an approval with a UUID opens that send; any other id is dropped; urgent opens the filter; a mailbox problem opens Mailboxes", () => {
    expect(noticePath("approval", ID)).toBe(`/approvals?id=${ID}`);
    expect(noticePath("approval", ID.toUpperCase())).toBe(`/approvals?id=${ID}`);
    expect(noticePath("approval", "x y")).toBe("/approvals");
    expect(noticePath("approval", "../../evil?x=1")).toBe("/approvals");
    expect(noticePath("approval", null)).toBe("/approvals");
    expect(noticePath("urgent", null)).toBe("/activity?category=urgent");
    expect(noticePath("urgent", ID)).toBe("/activity?category=urgent");
    expect(noticePath("auth_error", null)).toBe("/mailboxes");
    expect(noticePath("test", null)).toBe("/settings");
  });

  test("every kind has a path on the panel: one slash, no scheme, no host, no hash", () => {
    for (const kind of [...noticeKinds, "test" as const]) {
      const path = noticePath(kind, ID);
      expect(path).toMatch(/^\/[a-z]+(\?[a-z]+=[a-z0-9-]+)?$/);
    }
  });
});

describe("pushPayloadSchema", () => {
  const ok: PushPayload = { v: 1, id: "r1", kind: "urgent", count: 2, itemId: null, lang: "en" };

  test("2. it refuses an extra key (a subject) and a count of -1; it keeps the six keys", () => {
    expect(pushPayloadSchema.safeParse(ok).success).toBe(true);
    expect(pushPayloadSchema.safeParse({ ...ok, subject: "Salary" }).success).toBe(false);
    expect(pushPayloadSchema.safeParse({ ...ok, count: -1 }).success).toBe(false);
    expect(pushPayloadSchema.safeParse({ ...ok, count: 1.5 }).success).toBe(false);
    expect(pushPayloadSchema.safeParse({ ...ok, v: 2 }).success).toBe(false);
    expect(pushPayloadSchema.safeParse({ ...ok, lang: "de" }).success).toBe(false);
    expect(pushPayloadSchema.safeParse({ ...ok, kind: "digest" }).success).toBe(false);
    expect(pushPayloadSchema.safeParse({ ...ok, id: "" }).success).toBe(false);
    expect(pushPayloadSchema.safeParse({ v: 1, kind: "urgent", count: 2, itemId: null, lang: "en" }).success).toBe(
      false
    );
  });

  test("4. the test payload of the device API passes; every push kind passes; the longest payload stays under 256 bytes", () => {
    // The literal of `POST /api/me/push/test` (apps/server/src/modules/channels/push/routes.ts).
    expect(
      pushPayloadSchema.safeParse({ v: 1, id: ID, kind: "test", count: 1, itemId: null, lang: "pl" }).success
    ).toBe(true);
    for (const kind of pushPayloadKinds) {
      const payload = { v: 1, id: ID, kind, count: 99_999, itemId: ID, lang: "pl" };
      expect(pushPayloadSchema.safeParse(payload).success).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(256);
    }
  });
});

describe("groups", () => {
  test("4. every push kind is in exactly one group; the group list matches the kinds; other kinds have no group", () => {
    for (const kind of pushKinds) {
      const holders = noticeGroupNames.filter((group) => (noticeGroups[group] as readonly string[]).includes(kind));
      expect([kind, holders.length]).toEqual([kind, 1]);
      expect(noticeGroupOf(kind)).toBe(holders[0] ?? null);
    }
    expect(new Set(pushKinds).size).toBe(pushKinds.length);
    expect(noticeGroupOf("urgent")).toBe("urgent");
    expect(noticeGroupOf("not_triaged")).toBe("urgent");
    expect(noticeGroupOf("approval_set")).toBe("approvals");
    expect(noticeGroupOf("sync_ok")).toBe("updates");
    for (const kind of [
      "digest",
      "weekly_report",
      "trust_report_ready",
      "autonomy_paused",
      "loop_consent",
      "reply_result",
    ] as const) {
      expect(noticeGroupOf(kind)).toBeNull();
    }
  });
});
