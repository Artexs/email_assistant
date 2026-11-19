import { describe, expect, test } from "bun:test";

import { buildWeekStats } from "../metrics/week-stats";

import { statsQuerySchema, statsResponseSchema, weekStatsSchema } from "./stats";

const empty = {
  truth: [],
  delegations: [],
  loops: null,
  moves: [],
  rejects: [],
  mistakes: [],
  handled: [],
  urgent: [],
  llmCalls: [],
  replies: { pairs: [], requests: [] },
  gates: [],
  mailboxes: 1,
};
const stats = buildWeekStats(empty, {
  weekStart: "2026-11-16",
  mailboxId: null,
  timeZone: "Europe/Warsaw",
  now: new Date("2026-11-25T10:00:00Z"),
});

describe("weekStatsSchema", () => {
  test("m2 has no split without loops; a split with a bad kind or an extra key is refused", () => {
    expect(stats.m2.byKind).toBeUndefined();
    const withLoops = buildWeekStats(
      { ...empty, loops: [] },
      { weekStart: "2026-11-16", mailboxId: null, timeZone: "Europe/Warsaw", now: new Date("2026-11-25T10:00:00Z") }
    );
    expect(weekStatsSchema.safeParse(withLoops).success).toBe(true);
    const byKind = { ...withLoops.m2.byKind, other: withLoops.m2.byKind?.waiting };
    expect(weekStatsSchema.safeParse({ ...withLoops, m2: { ...withLoops.m2, byKind } }).success).toBe(false);
  });

  test("refuses an extra key, at the top and inside a metric", () => {
    expect(weekStatsSchema.safeParse({ ...stats, subject: "x" }).success).toBe(false);
    expect(weekStatsSchema.safeParse({ ...stats, m4: { ...stats.m4, subject: "x" } }).success).toBe(false);
  });

  test("the reply draft counts are all zero for an empty week, a stored week with no key reads all zero, and a bad count is refused", () => {
    expect(stats.replyDrafts.made).toBe(0);
    expect(Object.values(stats.replyDrafts).every((count) => count === 0)).toBe(true);
    const old: Partial<typeof stats> = { ...stats };
    delete old.replyDrafts;
    expect(weekStatsSchema.parse(old).replyDrafts).toEqual(stats.replyDrafts);
    expect(weekStatsSchema.safeParse({ ...stats, replyDrafts: { ...stats.replyDrafts, made: -1 } }).success).toBe(
      false
    );
    expect(weekStatsSchema.safeParse({ ...stats, replyDrafts: { ...stats.replyDrafts, subject: 1 } }).success).toBe(
      false
    );
    const partial: Partial<typeof stats.replyDrafts> = { ...stats.replyDrafts };
    delete partial.made;
    expect(weekStatsSchema.safeParse({ ...stats, replyDrafts: partial }).success).toBe(false);
  });

  test("refuses a negative count and a bad week start", () => {
    expect(weekStatsSchema.safeParse({ ...stats, m4: { ...stats.m4, handled: -1 } }).success).toBe(false);
    expect(weekStatsSchema.safeParse({ ...stats, weekStart: "16.11.2026" }).success).toBe(false);
  });

  test("the response holds a list of weeks", () => {
    expect(statsResponseSchema.parse({ weeks: [stats] }).weeks).toHaveLength(1);
  });
});

describe("statsQuerySchema", () => {
  test("defaults to 8 weeks", () => {
    expect(statsQuerySchema.parse({})).toEqual({ weeks: 8 });
  });

  test("refuses more than 12 weeks", () => {
    expect(statsQuerySchema.safeParse({ weeks: "13" }).success).toBe(false);
    expect(statsQuerySchema.parse({ weeks: "12" }).weeks).toBe(12);
  });
});
