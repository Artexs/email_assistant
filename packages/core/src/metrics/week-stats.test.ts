import { describe, expect, test } from "bun:test";

import { weekStatsSchema } from "../web/stats";

import {
  delegationRow,
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
import { openLoopsOnTime } from "./m2";
import { seriousMistakes } from "./m3";
import { handledShare } from "./m4";
import { urgentLatency } from "./m5";
import { unitCost } from "./m7";
import { autoEvidence } from "./m8";
import { buildWeekStats, type WeekRows } from "./week-stats";
import { weekRange } from "./week";

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
    expect(stats.m2).toEqual(openLoopsOnTime(input.delegations, { range, timeZone, now }));
    expect(stats.m3).toEqual(seriousMistakes(input, range));
    expect(stats.m4).toEqual(handledShare(input.handled));
    expect(stats.m5).toEqual(urgentLatency(input.urgent, { timeZone }));
    expect(stats.m7).toEqual(unitCost(input.llmCalls, { mailboxes: 2 }));
    expect(stats.m8).toEqual(autoEvidence(input.gates));
    expect(weekStatsSchema.parse(stats)).toEqual(stats);
  });

  test("an empty week passes the schema", () => {
    const empty: WeekRows = {
      truth: [],
      delegations: [],
      moves: [],
      rejects: [],
      mistakes: [],
      handled: [],
      urgent: [],
      llmCalls: [],
      gates: [],
      mailboxes: 0,
    };
    const stats = buildWeekStats(empty, { weekStart, mailboxId: null, timeZone, now });
    expect(stats.mailboxId).toBeNull();
    expect(stats.m5.p90Minutes).toBeNull();
    expect(stats.m7.mailboxes).toBe(1);
  });
});
