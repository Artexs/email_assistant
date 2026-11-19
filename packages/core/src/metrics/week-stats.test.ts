import { describe, expect, test } from "bun:test";

import { weekStatsSchema } from "../web/stats";

import {
  delegationRow,
  loopRow,
  gateRow,
  handledRow,
  hiddenMoveRow,
  llmCallRow,
  mistakeRow,
  rejectRow,
  truthRow,
  urgentRow,
} from "./fixtures";
import { missedImportant } from "./m1";
import { openLoopsOnTime, totalsOf } from "./m2";
import { seriousMistakes } from "./m3";
import { handledShare } from "./m4";
import { urgentLatency } from "./m5";
import { unitCost } from "./m7";
import { realLabelEvidence } from "./m8";
import { weekRange } from "./week";
import { buildWeekStats, type WeekRows } from "./week-stats";

const timeZone = "Europe/Warsaw";
const weekStart = "2026-11-16";
const now = new Date("2026-11-25T10:00:00Z");
const mailboxId = "00000000-0000-4000-8000-0000000000aa";

function rows(): WeekRows {
  const receivedAt = new Date("2026-11-17T09:00:00Z");
  return {
    truth: [
      truthRow({ predicted: "info", truth: "needs_reply", truthSource: "review" }),
      truthRow({ predicted: "urgent" }),
      truthRow({ predicted: "spam" }),
    ],
    delegations: [
      delegationRow({ dueAt: new Date("2026-11-18T09:00:00Z"), answeredAt: new Date("2026-11-18T12:00:00Z") }),
    ],
    loops: null,
    moves: [hiddenMoveRow({ folder: "ai_info", truth: "urgent" })],
    rejects: [rejectRow({ reason: "wrong_person" }), rejectRow({ reason: "not_needed" })],
    mistakes: [mistakeRow()],
    handled: [
      handledRow({ category: "info", mailboxActionApplied: true }),
      handledRow({ category: "spam", mailboxActionLogged: true }),
      handledRow({ category: "needs_reply" }),
    ],
    urgent: [urgentRow({ receivedAt, noticeAt: new Date(receivedAt.getTime() + 120_000) }), urgentRow({ receivedAt })],
    llmCalls: [llmCallRow(), llmCallRow({ model: "unknown-model" })],
    replies: { pairs: [], requests: [] },
    gates: [gateRow(), gateRow({ precision: null, kept: 0, decision: "no-go: too few" })],
    mailboxes: 2,
  };
}

describe("buildWeekStats", () => {
  test("each metric equals the result of its own function, and the schema accepts it", () => {
    const input = rows();
    const range = weekRange(weekStart, timeZone);
    const stats = buildWeekStats(input, { weekStart, mailboxId, timeZone, now });
    expect(stats.weekStart).toBe(weekStart);
    expect(stats.mailboxId).toBe(mailboxId);
    expect(stats.m1).toEqual(missedImportant(input.truth));
    expect(stats.m2).toEqual(
      totalsOf(openLoopsOnTime({ delegations: input.delegations, loops: [] }, { range, timeZone, now }))
    );
    expect(stats.m3).toEqual(seriousMistakes(input, range));
    expect(stats.m4).toEqual(handledShare(input.handled));
    expect(stats.m5).toEqual(urgentLatency(input.urgent, { timeZone }));
    expect(stats.m7).toEqual(unitCost(input.llmCalls, { mailboxes: 2 }));
    expect(stats.m8).toEqual(realLabelEvidence(input.gates));
    expect(weekStatsSchema.parse(stats)).toEqual(stats);
  });

  test("with loops the split is in m2; the totals hold the loops", () => {
    const input = { ...rows(), loops: [loopRow({ kind: "promised", dueAt: new Date("2026-11-18T09:00:00Z") })] };
    const stats = buildWeekStats(input, { weekStart, mailboxId, timeZone, now });
    expect(stats.m2.due).toBe(2);
    expect(stats.m2.byKind?.promised).toEqual({ due: 1, closedOnTime: 0, surfacedOnTime: 0, pending: 0 });
    expect(stats.m2.byKind?.delegation.closedOnTime).toBe(1);
    expect(weekStatsSchema.parse(stats)).toEqual(stats);
  });

  test("the reply draft counts of the rows reach the stats", () => {
    const stats = buildWeekStats(
      {
        ...rows(),
        replies: {
          pairs: [
            { status: "applied", reason: null },
            { status: "expired", reason: "answered" },
          ],
          requests: [{ status: "no_draft" }],
        },
      },
      { weekStart, mailboxId, timeZone, now }
    );
    expect(stats.replyDrafts).toMatchObject({ made: 2, sent_by_tap: 1, answered: 1, no_draft: 1 });
    expect(weekStatsSchema.parse(stats)).toEqual(stats);
  });

  test("an empty week passes the schema", () => {
    const empty: WeekRows = {
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
      mailboxes: 0,
    };
    const stats = buildWeekStats(empty, { weekStart, mailboxId: null, timeZone, now });
    expect(stats.mailboxId).toBeNull();
    expect(stats.m5.p90Minutes).toBeNull();
    expect(stats.m7.mailboxes).toBe(1);
  });

  test("M8 rows carry the three trust keys; a row stored before F110 has none and reads null", () => {
    const trust = {
      global: { decision: "no-go", provisional: true, wilsonLower: null, cases: 12 },
      history: { outcome: "fail", acted: 100, moved: 3 },
      trip: { tripped: true, reason: "corrections" },
    } as const;
    const given = buildWeekStats(
      { ...rows(), gates: [gateRow({ category: "spam", ...trust }), gateRow({ category: "info" })] },
      { weekStart, mailboxId, timeZone, now }
    );
    expect(given.m8[0]).toMatchObject(trust);
    expect(given.m8[1]).toMatchObject({ global: null, history: null, trip: null });
    // A queued report view from before the change: the keys are missing.
    const old = JSON.parse(JSON.stringify(given)) as { m8: Record<string, unknown>[] };
    old.m8 = old.m8.map(({ global: _g, history: _h, trip: _t, ...rest }) => rest);
    const parsed = weekStatsSchema.parse(old);
    expect(parsed.m8.every((row) => row.global === null && row.history === null && row.trip === null)).toBe(true);
    expect(() => weekStatsSchema.parse({ ...given, m8: [{ ...given.m8[0], trip: { tripped: true } }] })).toThrow();
  });
});
