import { describe, expect, test } from "bun:test";

import { delegationRow, loopRow } from "./fixtures";
import { DELEGATION_DEFAULT_DUE_MS, openLoopsOnTime, totalsOf } from "./m2";
import { weekRange } from "./week";

const TZ = "Europe/Warsaw";
const range = weekRange("2026-11-16", TZ);
const at = (iso: string): Date => new Date(iso);

const ZERO = { due: 0, closedOnTime: 0, surfacedOnTime: 0, pending: 0 };
const NOW = at("2026-11-30T12:00:00Z");
const run = (
  delegations: Parameters<typeof openLoopsOnTime>[0]["delegations"],
  loops: Parameters<typeof openLoopsOnTime>[0]["loops"],
  now: Date = NOW,
  week = range
) => openLoopsOnTime({ delegations, loops }, { range: week, timeZone: TZ, now });

describe("openLoopsOnTime: delegations", () => {
  test("counts due, closed and surfaced loops by the working-day deadline (T7)", () => {
    const rows = [
      delegationRow({ dueAt: at("2026-11-17T09:00Z"), answeredAt: at("2026-11-18T09:00Z") }),
      delegationRow({ dueAt: at("2026-11-20T09:00Z"), answeredAt: at("2026-11-23T08:00Z") }),
      delegationRow({ dueAt: at("2026-11-18T09:00Z"), overdueAt: at("2026-11-19T06:30Z") }),
      delegationRow({ dueAt: at("2026-11-18T09:00Z") }),
      delegationRow({ dueAt: null, sentAt: at("2026-11-16T09:00Z") }),
      delegationRow({ dueAt: at("2026-11-23T09:00Z") }),
      delegationRow({ dueAt: at("2026-11-18T09:00Z"), cancelled: true }),
    ];
    const result = run(rows, []);
    expect(totalsOf(result)).toEqual({ due: 5, closedOnTime: 2, surfacedOnTime: 3, pending: 0 });
    expect(result.byKind.delegation).toEqual(totalsOf(result));
    expect(result.byKind.waiting).toEqual(ZERO);
  });

  test("a loop whose deadline is still ahead is pending, not due", () => {
    const rows = [delegationRow({ dueAt: at("2026-11-20T09:00Z") })];
    expect(totalsOf(run(rows, [], at("2026-11-21T08:00:00Z")))).toEqual({ ...ZERO, pending: 1 });
  });

  test("a loop closed before its deadline counts even when the deadline is ahead", () => {
    const rows = [delegationRow({ dueAt: at("2026-11-20T09:00Z"), doneAt: at("2026-11-20T12:00Z") })];
    expect(totalsOf(run(rows, [], at("2026-11-21T08:00:00Z")))).toEqual({
      due: 1,
      closedOnTime: 1,
      surfacedOnTime: 1,
      pending: 0,
    });
  });

  test("an answer after the deadline is not on time", () => {
    const rows = [delegationRow({ dueAt: at("2026-11-17T09:00Z"), answeredAt: at("2026-11-19T09:00Z") })];
    expect(totalsOf(run(rows, []))).toEqual({ due: 1, closedOnTime: 0, surfacedOnTime: 0, pending: 0 });
  });

  test("the default due time is 3 days", () => {
    expect(DELEGATION_DEFAULT_DUE_MS).toBe(259_200_000);
  });
});

// Week of Mon 2026-11-23, Warsaw (UTC+1). A loop due Mon 17:00 local = 16:00Z; its deadline is Tue 17:00 local = 16:00Z.
describe("openLoopsOnTime: loops", () => {
  const week = weekRange("2026-11-23", TZ);
  const due = at("2026-11-23T16:00:00Z");
  const runLoops = (loops: Parameters<typeof run>[1]) => run([], loops, NOW, week);

  test("T1: replied Tuesday 10:00 is closed and surfaced on time", () => {
    const result = runLoops([loopRow({ dueAt: due, closeReason: "replied", closedAt: at("2026-11-24T09:00:00Z") })]);
    expect(result.byKind.waiting).toEqual({ due: 1, closedOnTime: 1, surfacedOnTime: 1, pending: 0 });
  });

  test("T2: replied Wednesday 10:00 is not closed; shown Monday 08:00 it is surfaced", () => {
    const late = { dueAt: due, closeReason: "replied", closedAt: at("2026-11-25T09:00:00Z") };
    expect(runLoops([loopRow(late)]).byKind.waiting).toEqual({
      due: 1,
      closedOnTime: 0,
      surfacedOnTime: 0,
      pending: 0,
    });
    const shown = runLoops([loopRow({ ...late, surfacedAt: at("2026-11-23T07:00:00Z") })]);
    expect(shown.byKind.waiting).toEqual({ due: 1, closedOnTime: 0, surfacedOnTime: 1, pending: 0 });
  });

  test("each answer reason closes; stale and expired do not", () => {
    const closedAt = at("2026-11-24T09:00:00Z");
    const reasons = ["replied", "replied_subject", "done", "later_reply", "stale", "expired"];
    const result = runLoops(reasons.map((closeReason) => loopRow({ dueAt: due, closeReason, closedAt })));
    expect(totalsOf(result)).toEqual({ due: 6, closedOnTime: 4, surfacedOnTime: 4, pending: 0 });
  });

  test("T3: dropped, untracked and sent_off loops are not counted", () => {
    const closedAt = at("2026-11-24T09:00:00Z");
    const result = runLoops(
      ["dropped", "untracked", "sent_off"].map((closeReason) => loopRow({ dueAt: due, closeReason, closedAt }))
    );
    expect(totalsOf(result)).toEqual(ZERO);
  });

  test("T4: a stale loop is due and not closed", () => {
    const stale = loopRow({ dueAt: due, closeReason: "stale", closedAt: at("2026-12-20T09:00:00Z") });
    expect(runLoops([stale]).byKind.waiting).toEqual({ due: 1, closedOnTime: 0, surfacedOnTime: 0, pending: 0 });
  });

  test("T5: a follow-up applied Tuesday closes the loop on time, even when it is still open", () => {
    const followed = loopRow({ dueAt: due, firstFollowUpAt: at("2026-11-24T09:00:00Z") });
    expect(runLoops([followed]).byKind.waiting).toEqual({ due: 1, closedOnTime: 1, surfacedOnTime: 1, pending: 0 });
    const late = loopRow({ dueAt: due, firstFollowUpAt: at("2026-11-25T09:00:00Z") });
    expect(runLoops([late]).byKind.waiting).toEqual({ due: 1, closedOnTime: 0, surfacedOnTime: 0, pending: 0 });
  });

  test("an open loop before its deadline is pending; one due in another week is left out", () => {
    const now = at("2026-11-24T10:00:00Z");
    const open = loopRow({ dueAt: due });
    expect(run([], [open], now, week).byKind.waiting).toEqual({ ...ZERO, pending: 1 });
    expect(run([], [loopRow({ dueAt: at("2026-11-30T16:00:00Z") })], NOW, week).byKind.waiting).toEqual(ZERO);
  });

  test("T6: byKind sums to the totals", () => {
    const closedAt = at("2026-11-24T09:00:00Z");
    const result = run(
      [delegationRow({ dueAt: due, answeredAt: closedAt })],
      [
        loopRow({ kind: "waiting", dueAt: due, closeReason: "replied", closedAt }),
        loopRow({ kind: "promised", dueAt: due, closeReason: "done", closedAt }),
        loopRow({ kind: "promised", dueAt: due }),
        loopRow({ kind: "delegated", dueAt: due, surfacedAt: at("2026-11-23T07:00:00Z") }),
      ],
      NOW,
      week
    );
    expect(result.byKind.promised).toEqual({ due: 2, closedOnTime: 1, surfacedOnTime: 1, pending: 0 });
    expect(result.byKind.delegated).toEqual({ due: 1, closedOnTime: 0, surfacedOnTime: 1, pending: 0 });
    expect(totalsOf(result)).toEqual({ due: 5, closedOnTime: 3, surfacedOnTime: 4, pending: 0 });
    for (const field of ["due", "closedOnTime", "surfacedOnTime", "pending"] as const) {
      const sum = Object.values(result.byKind).reduce((acc, tally) => acc + tally[field], 0);
      expect(sum).toBe(result[field]);
    }
  });
});
