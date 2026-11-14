import { describe, expect, test } from "bun:test";

import { buildWeekStats } from "../metrics/week-stats";

import { statsQuerySchema, statsResponseSchema, weekStatsSchema } from "./stats";

const empty = {
  truth: [],
  delegations: [],
  moves: [],
  rejects: [],
  mistakes: [],
  handled: [],
  urgent: [],
  llmCalls: [],
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
  test("refuses an extra key, at the top and inside a metric", () => {
    expect(weekStatsSchema.safeParse({ ...stats, subject: "x" }).success).toBe(false);
    expect(weekStatsSchema.safeParse({ ...stats, m4: { ...stats.m4, subject: "x" } }).success).toBe(false);
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
