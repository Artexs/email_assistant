import { describe, expect, test } from "bun:test";
import type { ActivityItem } from "@ea/core/web";

import { dayGroups } from "./activity-days";

const ZONE = "Europe/Warsaw";

function item(n: number, receivedAt: string): ActivityItem {
  return {
    emailId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    mailboxId: "6f1d6f2e-8a3b-4c5d-9e7f-0123456789ab",
    receivedAt,
    triagedAt: receivedAt,
    from: null,
    subject: null,
    category: "info",
    confidence: 0.9,
    modelCategory: null,
    aiText: null,
    phrase: "stays in INBOX",
    actions: [],
    undoable: false,
    undoPending: false,
    feedback: null,
    delegation: null,
    suspicious: [],
    rule: null,
  };
}

function summary(groups: ReturnType<typeof dayGroups>) {
  return groups.map((group) => ({ day: group.day, label: group.label, size: group.items.length }));
}

describe("dayGroups", () => {
  test("yesterday is the calendar day before the local date of now, across a spring clock change", () => {
    const now = new Date("2026-03-29T10:00:00Z");
    const groups = dayGroups([item(1, "2026-03-28T23:30:00Z"), item(2, "2026-03-28T22:30:00Z")], ZONE, now);
    expect(summary(groups)).toEqual([
      { day: "2026-03-29", label: "today", size: 1 },
      { day: "2026-03-28", label: "yesterday", size: 1 },
    ]);
  });

  test("older days are date groups and the order of the items does not change", () => {
    const items = [item(1, "2026-11-20T12:00:00Z"), item(2, "2026-11-20T08:00:00Z"), item(3, "2026-11-18T09:00:00Z")];
    const groups = dayGroups(items, ZONE, new Date("2026-11-24T10:00:00Z"));
    expect(summary(groups)).toEqual([
      { day: "2026-11-20", label: "date", size: 2 },
      { day: "2026-11-18", label: "date", size: 1 },
    ]);
    expect(groups.flatMap((group) => group.items)).toEqual(items);
  });

  test("an empty list has no groups", () => {
    expect(dayGroups([], ZONE, new Date("2026-11-24T10:00:00Z"))).toEqual([]);
  });
});
