import { describe, expect, test } from "bun:test";

import { dueDigestSlot, isLateSlot, nextDigestTime, parseDigestTimes, parseDigestTimesInput } from "./schedule";

const TZ = "Europe/Warsaw";
const TIMES = ["08:00", "16:00"];

function due(nowIso: string, afterKey: string | null, times: readonly string[] = TIMES): string | null {
  return dueDigestSlot({ now: new Date(nowIso), timeZone: TZ, times, afterKey })?.key ?? null;
}

describe("parseDigestTimes", () => {
  test("sorts, drops duplicates and seconds", () => {
    expect(parseDigestTimes(["16:00:00", "08:00:00", "08:00:00"])).toEqual(["08:00", "16:00"]);
  });

  test("drops invalid values", () => {
    expect(parseDigestTimes(["25:00:00"])).toEqual([]);
  });
});

describe("parseDigestTimesInput", () => {
  test("a list", () => {
    expect(parseDigestTimesInput("08:00,16:00")).toEqual({ ok: true, times: ["08:00", "16:00"] });
    expect(parseDigestTimesInput(" 16:00 , 08:00 ")).toEqual({ ok: true, times: ["08:00", "16:00"] });
    expect(parseDigestTimesInput("08:00,08:00")).toEqual({ ok: true, times: ["08:00"] });
  });

  test("none", () => {
    expect(parseDigestTimesInput("NONE")).toEqual({ ok: true, times: [] });
  });

  test("errors", () => {
    expect(parseDigestTimesInput("8:00")).toEqual({ ok: false, error: "bad time: 8:00" });
    expect(parseDigestTimesInput("24:00")).toEqual({ ok: false, error: "bad time: 24:00" });
    expect(parseDigestTimesInput("")).toEqual({ ok: false, error: "empty input" });
    const seven = "01:00,02:00,03:00,04:00,05:00,06:00,07:00";
    expect(parseDigestTimesInput(seven)).toEqual({ ok: false, error: "too many times (max 6)" });
  });
});

describe("dueDigestSlot", () => {
  test("not yet due", () => {
    expect(due("2026-11-06T06:59:00Z", "2026-11-05T16:00")).toBeNull();
  });

  test("due at the slot time, once", () => {
    expect(due("2026-11-06T07:00:00Z", "2026-11-05T16:00")).toBe("2026-11-06T08:00");
    expect(due("2026-11-06T07:00:00Z", "2026-11-06T08:00")).toBeNull();
  });

  test("late within 6 hours", () => {
    expect(due("2026-11-06T12:00:00Z", "2026-11-05T16:00")).toBe("2026-11-06T08:00");
  });

  test("a slot older than 6 hours is skipped", () => {
    expect(due("2026-11-06T14:30:00Z", "2026-11-05T16:00")).toBeNull();
  });

  test("the slot of the day before, after midnight", () => {
    expect(due("2026-11-06T23:10:00Z", "2026-11-05T23:30", ["23:30"])).toBe("2026-11-06T23:30");
  });

  test("slots before the link time never count", () => {
    expect(due("2026-11-06T09:00:00Z", "2026-11-06T09:12")).toBeNull();
  });

  test("no times", () => {
    expect(due("2026-11-06T07:00:00Z", null, [])).toBeNull();
  });

  test("autumn: the repeated hour gives one digest", () => {
    const times = ["02:30"];
    expect(due("2026-10-25T00:30:00Z", "2026-10-24T02:30", times)).toBe("2026-10-25T02:30");
    expect(due("2026-10-25T01:30:00Z", "2026-10-25T02:30", times)).toBeNull();
  });

  test("spring: a time in the gap goes out at 03:00", () => {
    expect(due("2027-03-28T01:00:00Z", "2027-03-27T02:30", ["02:30"])).toBe("2027-03-28T02:30");
  });
});

describe("nextDigestTime", () => {
  const next = (nowIso: string, times: readonly string[] = TIMES) =>
    nextDigestTime({ now: new Date(nowIso), timeZone: TZ, times });

  test("later today", () => {
    expect(next("2026-11-06T07:30:00Z")).toEqual({ date: "2026-11-06", time: "16:00" });
  });

  test("tomorrow", () => {
    expect(next("2026-11-06T15:30:00Z")).toEqual({ date: "2026-11-07", time: "08:00" });
  });

  test("no times", () => {
    expect(next("2026-11-06T07:30:00Z", [])).toBeNull();
  });
});

describe("isLateSlot", () => {
  const slot = { key: "2026-11-06T08:00", date: "2026-11-06", time: "08:00" };

  test("late after 10 minutes", () => {
    expect(isLateSlot(slot, new Date("2026-11-06T07:05:00Z"), TZ)).toBe(false);
    expect(isLateSlot(slot, new Date("2026-11-06T07:11:00Z"), TZ)).toBe(true);
  });
});
