import { describe, expect, test } from "bun:test";

import { delegationRow } from "./fixtures";
import { DELEGATION_DEFAULT_DUE_MS, openLoopsOnTime } from "./m2";
import { weekRange } from "./week";

const TZ = "Europe/Warsaw";
const range = weekRange("2026-11-16", TZ);
const at = (iso: string): Date => new Date(iso);

describe("openLoopsOnTime", () => {
  test("counts due, closed and surfaced loops by the working-day deadline", () => {
    const rows = [
      delegationRow({ dueAt: at("2026-11-17T09:00Z"), answeredAt: at("2026-11-18T09:00Z") }),
      delegationRow({ dueAt: at("2026-11-20T09:00Z"), answeredAt: at("2026-11-23T08:00Z") }),
      delegationRow({ dueAt: at("2026-11-18T09:00Z"), overdueAt: at("2026-11-19T06:30Z") }),
      delegationRow({ dueAt: at("2026-11-18T09:00Z") }),
      delegationRow({ dueAt: null, sentAt: at("2026-11-16T09:00Z") }),
      delegationRow({ dueAt: at("2026-11-23T09:00Z") }),
      delegationRow({ dueAt: at("2026-11-18T09:00Z"), cancelled: true }),
    ];
    expect(openLoopsOnTime(rows, { range, timeZone: TZ, now: at("2026-11-30T12:00:00Z") })).toEqual({
      due: 5,
      closedOnTime: 2,
      surfacedOnTime: 3,
      pending: 0,
    });
  });

  test("a loop whose deadline is still ahead is pending, not due", () => {
    const rows = [delegationRow({ dueAt: at("2026-11-20T09:00Z") })];
    expect(openLoopsOnTime(rows, { range, timeZone: TZ, now: at("2026-11-21T08:00:00Z") })).toEqual({
      due: 0,
      closedOnTime: 0,
      surfacedOnTime: 0,
      pending: 1,
    });
  });

  test("a loop closed before its deadline counts even when the deadline is ahead", () => {
    const rows = [delegationRow({ dueAt: at("2026-11-20T09:00Z"), doneAt: at("2026-11-20T12:00Z") })];
    expect(openLoopsOnTime(rows, { range, timeZone: TZ, now: at("2026-11-21T08:00:00Z") })).toEqual({
      due: 1,
      closedOnTime: 1,
      surfacedOnTime: 1,
      pending: 0,
    });
  });

  test("an answer after the deadline is not on time", () => {
    const rows = [delegationRow({ dueAt: at("2026-11-17T09:00Z"), answeredAt: at("2026-11-19T09:00Z") })];
    expect(openLoopsOnTime(rows, { range, timeZone: TZ, now: at("2026-11-30T12:00:00Z") })).toMatchObject({
      due: 1,
      closedOnTime: 0,
      surfacedOnTime: 0,
    });
  });

  test("the default due time is 3 days", () => {
    expect(DELEGATION_DEFAULT_DUE_MS).toBe(259_200_000);
  });
});
