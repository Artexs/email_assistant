import { describe, expect, test } from "bun:test";

import { urgentRow } from "./fixtures";
import { urgentLatency } from "./m5";

const timeZone = "Europe/Warsaw";
// 2026-11-17 is CET (UTC+1): 09:00Z = 10:00 local.
const at = (hhmmZ: string): Date => new Date(`2026-11-17T${hhmmZ}:00Z`);
const delays = [1, 1, 2, 2, 2, 3, 3, 4, 6, 9];

function tenNoticed() {
  return delays.map((minutes) => {
    const receivedAt = at("09:00");
    return urgentRow({ receivedAt, noticeAt: new Date(receivedAt.getTime() + minutes * 60_000) });
  });
}

describe("urgentLatency", () => {
  test("takes the nearest-rank p90 of the notice delays", () => {
    expect(urgentLatency(tenNoticed(), { timeZone })).toEqual({
      urgent: 10,
      noticed: 10,
      withoutNotice: 0,
      quietHours: 0,
      p90Minutes: 6,
    });
  });

  test("leaves quiet-hours mail out and counts mail without a notice", () => {
    const rows = [
      ...tenNoticed(),
      urgentRow({ receivedAt: at("22:30"), noticeAt: null }), // 23:30 local
      urgentRow({ receivedAt: at("11:00"), noticeAt: null }), // 12:00 local
    ];
    expect(urgentLatency(rows, { timeZone })).toEqual({
      urgent: 11,
      noticed: 10,
      withoutNotice: 1,
      quietHours: 1,
      p90Minutes: 6,
    });
  });

  test("no rows → null and zeros", () => {
    expect(urgentLatency([], { timeZone })).toEqual({
      urgent: 0,
      noticed: 0,
      withoutNotice: 0,
      quietHours: 0,
      p90Minutes: null,
    });
  });

  test("a notice before the arrival counts as 0 minutes", () => {
    const receivedAt = at("09:00");
    const rows = [urgentRow({ receivedAt, noticeAt: new Date(receivedAt.getTime() - 60_000) })];
    expect(urgentLatency(rows, { timeZone }).p90Minutes).toBe(0);
  });
});
