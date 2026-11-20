import { describe, expect, test } from "bun:test";

import type { Scenario } from "../scenario";
import type { Slot } from "../slot";

import { liveRunId, planLiveRun, type LiveRunPlan, type LiveRunRefusal } from "./run-plan";

// The lab-01 calendar: weekStart 2027-01-25 (Monday).
const scenario = {
  calendar: { bankStart: "2027-01-04", weekStart: "2027-01-25" },
  urgency: {
    vip: [],
    profile: {
      topics: [],
      deadlines: [
        { label: "Audit", due: "2027-02-05" },
        { label: "Budget", due: "2027-01-29" },
      ],
    },
  },
} as unknown as Scenario;

function slot(id: string, receivedAt: string): Slot {
  return { id, receivedAt } as unknown as Slot;
}

const slots: Slot[] = [
  slot("w-1-001", "2027-01-25T07:00:00.000Z"),
  slot("w-5-002", "2027-01-29T04:37:00.000Z"),
  slot("w-5-001", "2027-01-29T04:37:00.000Z"),
  slot("w-5-003", "2027-01-29T04:36:30.250Z"),
  slot("w-6-001", "2027-01-30T09:00:00.000Z"),
  slot("w-7-001", "2027-01-31T22:30:00.000Z"),
];

function plan(mode: "day" | "week", startDate: string): LiveRunPlan | LiveRunRefusal {
  return planLiveRun({ scenario, slots, mode, startDate, runId: "x" });
}

function ok(mode: "day" | "week", startDate: string): LiveRunPlan {
  const result = plan(mode, startDate);
  if ("refused" in result) throw new Error(`refused: ${result.refused}`);
  return result;
}

describe("planLiveRun", () => {
  test("1 week from a Monday shifts by −63 days and keeps the wall time", () => {
    const result = ok("week", "2026-11-23");
    expect(result.offsetDays).toBe(-63);
    expect(result.scenarioDays).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(result.items.find((item) => item.slotId === "w-5-001")?.at).toBe("2026-11-27T04:37:00.000Z");
    expect(result.items).toHaveLength(slots.length);
  });

  test("1 a slot at 04:37Z on the first scenario day keeps its time", () => {
    const result = planLiveRun({
      scenario,
      slots: [slot("w-1-009", "2027-01-25T04:37:00.000Z")],
      mode: "week",
      startDate: "2026-11-23",
      runId: "x",
    });
    expect(result).toMatchObject({ items: [{ slotId: "w-1-009", at: "2026-11-23T04:37:00.000Z" }] });
  });

  test("1 seconds and milliseconds stay; items sort by time, then slot id", () => {
    const result = ok("week", "2026-11-23");
    expect(result.items.map((item) => item.slotId)).toEqual([
      "w-1-001",
      "w-5-003",
      "w-5-001",
      "w-5-002",
      "w-6-001",
      "w-7-001",
    ]);
    expect(result.items.find((item) => item.slotId === "w-5-003")?.at).toBe("2026-11-27T04:36:30.250Z");
  });

  test.each([
    ["ids ascending", ["w-2-001", "w-2-002", "w-2-003"]],
    ["ids descending", ["w-2-003", "w-2-002", "w-2-001"]],
    ["ids mixed", ["w-2-002", "w-2-003", "w-2-001"]],
    ["ids mixed the other way", ["w-2-002", "w-2-001", "w-2-003"]],
  ])("three slots at one time sort by slot id, input %s", (_name, ids) => {
    const result = planLiveRun({
      scenario,
      slots: ids.map((id) => slot(id, "2027-01-26T08:00:00.000Z")),
      mode: "week",
      startDate: "2026-11-23",
      runId: "x",
    });
    expect(result).toMatchObject({
      items: [
        { slotId: "w-2-001", at: "2026-11-24T08:00:00.000Z" },
        { slotId: "w-2-002", at: "2026-11-24T08:00:00.000Z" },
        { slotId: "w-2-003", at: "2026-11-24T08:00:00.000Z" },
      ],
    });
  });

  test.each([
    ["the earlier slot first", ["w-2-002", "w-2-001"]],
    ["the later slot first", ["w-2-001", "w-2-002"]],
  ])("a later slot with the smaller id comes after an earlier slot with the larger id, input: %s", (_name, ids) => {
    const at: Record<string, string> = { "w-2-001": "2027-01-26T10:00:00.000Z", "w-2-002": "2027-01-26T09:00:00.000Z" };
    const result = planLiveRun({
      scenario,
      slots: ids.map((id) => slot(id, at[id] as string)),
      mode: "week",
      startDate: "2026-11-23",
      runId: "x",
    });
    expect(result).toMatchObject({
      items: [
        { slotId: "w-2-002", at: "2026-11-24T09:00:00.000Z" },
        { slotId: "w-2-001", at: "2026-11-24T10:00:00.000Z" },
      ],
    });
  });

  test("2 a week start that is not a Monday is refused", () => {
    expect(plan("week", "2026-11-24")).toEqual({ refused: "not_monday" });
  });

  test("bad dates are refused in both modes", () => {
    expect(plan("week", "2026-13-01")).toEqual({ refused: "bad_date" });
    expect(plan("day", "2026-02-30")).toEqual({ refused: "bad_date" });
    expect(plan("day", "tomorrow")).toEqual({ refused: "bad_date" });
  });

  test("3 a Friday day run plays scenario day 5 with only that day's slots", () => {
    const result = ok("day", "2026-11-27");
    expect(result.scenarioDays).toEqual([5]);
    expect(result.offsetDays).toBe(-63);
    expect(result.items.map((item) => item.slotId)).toEqual(["w-5-003", "w-5-001", "w-5-002"]);
  });

  test("4 a Saturday day run plays scenario day 6", () => {
    const result = ok("day", "2026-11-28");
    expect(result.scenarioDays).toEqual([6]);
    expect(result.offsetDays).toBe(-63);
    expect(result.items.map((item) => item.slotId)).toEqual(["w-6-001"]);
  });

  test("a Sunday slot after 23:00 Warsaw-wall stays on its Warsaw day", () => {
    // 22:30Z on 2027-01-31 is 23:30 Warsaw on Sunday.
    const result = ok("day", "2026-11-29");
    expect(result.scenarioDays).toEqual([7]);
    expect(result.items).toEqual([{ slotId: "w-7-001", at: "2026-11-29T22:30:00.000Z" }]);
  });

  test("5 a week that crosses a Warsaw offset change is refused", () => {
    expect(plan("week", "2027-03-22")).toEqual({ refused: "dst_change" });
    expect(plan("week", "2026-10-19")).toEqual({ refused: "dst_change" });
  });

  test("5 the tail counts: a run that ends before the change but whose tail crosses it is refused", () => {
    // Week 2027-03-15..21 ends 03-22 00:00; the tail ends 03-26: no change yet. Day 2027-03-24: tail ends 03-26.
    expect(plan("week", "2027-03-15")).not.toHaveProperty("refused");
    // Day 2027-03-27 (Saturday): the tail ends 2027-03-29 00:00 after the change on 03-28.
    expect(plan("day", "2027-03-27")).toEqual({ refused: "dst_change" });
    expect(plan("day", "2027-03-26")).not.toHaveProperty("refused");
  });

  test("6 a summer day run keeps the Warsaw wall time", () => {
    const result = ok("day", "2027-06-04");
    expect(result.offsetDays).toBe(126);
    expect(result.items.find((item) => item.slotId === "w-5-001")?.at).toBe("2027-06-04T03:37:00.000Z");
  });

  test("7 endsAt and tailEndsAt", () => {
    const week = ok("week", "2026-11-23");
    expect(week.endsAt).toBe("2026-11-29T23:00:00.000Z");
    expect(week.tailEndsAt).toBe("2026-12-03T23:00:00.000Z");
    const day = ok("day", "2026-11-27");
    expect(day.endsAt).toBe("2026-11-27T23:00:00.000Z");
    expect(day.tailEndsAt).toBe("2026-11-28T23:00:00.000Z");
  });

  test("the profile deadlines move by the offset", () => {
    expect(ok("week", "2026-11-23").deadlines).toEqual([
      { label: "Audit", due: "2026-12-04" },
      { label: "Budget", due: "2026-11-27" },
    ]);
  });

  test("the run id and mode pass through", () => {
    const result = planLiveRun({ scenario, slots, mode: "week", startDate: "2026-11-23", runId: "week-20261123-a1b2" });
    expect(result).toMatchObject({ runId: "week-20261123-a1b2", mode: "week", startDate: "2026-11-23" });
  });
});

describe("liveRunId", () => {
  test("9 builds mode, compact date and hex", () => {
    expect(liveRunId("week", "2026-11-23", "a1b2")).toBe("week-20261123-a1b2");
    expect(liveRunId("day", "2026-11-27", "00ff")).toBe("day-20261127-00ff");
  });
});
