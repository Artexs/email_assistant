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

describe("dueDigestSlot at the edges of the six hours", () => {
  const slotOf = (nowIso: string, afterKey: string | null, times: readonly string[]) =>
    dueDigestSlot({ now: new Date(nowIso), timeZone: TZ, times, afterKey });

  test("a slot exactly six hours old is not due; one minute younger is", () => {
    expect(slotOf("2026-11-06T13:00:00Z", null, ["08:00"])).toBeNull();
    expect(slotOf("2026-11-06T12:59:00Z", null, ["08:00"])).toEqual({
      key: "2026-11-06T08:00",
      date: "2026-11-06",
      time: "08:00",
    });
  });

  test("a slot at the clock of now is due; one minute ahead is not", () => {
    expect(slotOf("2026-11-06T07:00:00Z", null, ["08:00"])?.key).toBe("2026-11-06T08:00");
    expect(slotOf("2026-11-06T06:59:00Z", null, ["08:00"])).toBeNull();
  });

  test("a slot equal to the key after which none is wanted is not due; the next one is", () => {
    expect(slotOf("2026-11-06T07:00:00Z", "2026-11-06T08:00", ["08:00"])).toBeNull();
    expect(slotOf("2026-11-06T07:00:00Z", "2026-11-06T07:59", ["08:00"])?.key).toBe("2026-11-06T08:00");
  });

  test("the newest slot wins whatever the order of the times", () => {
    expect(slotOf("2026-11-06T23:30:00Z", null, ["23:00", "22:00"])?.key).toBe("2026-11-06T23:00");
  });

  test("across midnight the newest of the slots of both days wins and its date and time are split from the key", () => {
    expect(slotOf("2026-11-06T23:30:00Z", null, ["22:00", "23:00"])).toEqual({
      key: "2026-11-06T23:00",
      date: "2026-11-06",
      time: "23:00",
    });
    expect(slotOf("2026-11-06T23:30:00Z", "2026-11-06T23:00", ["22:00", "23:00", "00:30"])).toEqual({
      key: "2026-11-07T00:30",
      date: "2026-11-07",
      time: "00:30",
    });
  });

  test("a slot of the day before is due when it lies within the six hours, an older one is not", () => {
    expect(slotOf("2026-11-06T00:30:00Z", null, ["22:00", "01:30"])).toEqual({
      key: "2026-11-06T01:30",
      date: "2026-11-06",
      time: "01:30",
    });
    expect(slotOf("2026-11-06T00:30:00Z", "2026-11-06T01:29", ["22:00"])).toBeNull();
    expect(slotOf("2026-11-06T04:30:00Z", null, ["22:00", "23:00"])).toBeNull();
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

  test("the nearest time wins whatever the order of the times, and a time equal to now is not next", () => {
    expect(next("2026-11-06T06:00:00Z", ["16:00", "08:00"])).toEqual({ date: "2026-11-06", time: "08:00" });
    expect(next("2026-11-06T07:00:00Z", TIMES)).toEqual({ date: "2026-11-06", time: "16:00" });
  });
});

describe("the digest times a user types", () => {
  test("white space around the text is ignored, none in any letter case gives no times", () => {
    expect(parseDigestTimesInput("  NONE \n")).toEqual({ ok: true, times: [] });
    expect(parseDigestTimesInput(" 16:00 , 08:00 ")).toEqual({ ok: true, times: ["08:00", "16:00"] });
    expect(parseDigestTimesInput("  ")).toEqual({ ok: false, error: "empty input" });
  });

  test("six times are the most; the seventh is refused", () => {
    expect(parseDigestTimesInput("01:00,02:00,03:00,04:00,05:00,06:00")).toEqual({
      ok: true,
      times: ["01:00", "02:00", "03:00", "04:00", "05:00", "06:00"],
    });
    expect(parseDigestTimesInput("01:00,02:00,03:00,04:00,05:00,06:00,07:00")).toEqual({
      ok: false,
      error: "too many times (max 6)",
    });
  });
});

describe("isLateSlot", () => {
  const slot = { key: "2026-11-06T08:00", date: "2026-11-06", time: "08:00" };

  test("late after 10 minutes", () => {
    expect(isLateSlot(slot, new Date("2026-11-06T07:05:00Z"), TZ)).toBe(false);
    expect(isLateSlot(slot, new Date("2026-11-06T07:11:00Z"), TZ)).toBe(true);
  });

  test("exactly 10 minutes after the slot is not late; a millisecond more is", () => {
    expect(isLateSlot(slot, new Date("2026-11-06T07:10:00.000Z"), TZ)).toBe(false);
    expect(isLateSlot(slot, new Date("2026-11-06T07:10:00.001Z"), TZ)).toBe(true);
  });
});

describe("dueDigestSlot after a timezone change", () => {
  const TIMES_2 = ["08:00", "13:00"];
  const slotKey = (now: string, timeZone: string, afterKey: string, times: readonly string[] = TIMES_2) =>
    dueDigestSlot({ now: new Date(now), timeZone, times, afterKey })?.key ?? null;

  test("west move: the next slot waits for the new local time", () => {
    // characterisation: the note on the Settings page depends on this
    expect(slotKey("2026-11-11T13:30:00Z", "America/New_York", "2026-11-11T08:00")).toBeNull();
    expect(slotKey("2026-11-11T18:00:00Z", "America/New_York", "2026-11-11T08:00")).toBe("2026-11-11T13:00");
  });

  test("east move: the next slot is the next morning", () => {
    // characterisation: the note on the Settings page depends on this
    expect(slotKey("2026-11-11T14:00:00Z", "Asia/Tokyo", "2026-11-11T13:00")).toBeNull();
    expect(slotKey("2026-11-11T23:00:00Z", "Asia/Tokyo", "2026-11-11T13:00")).toBe("2026-11-12T08:00");
  });

  test("east move at once: a later slot of the same local day is due", () => {
    // characterisation: the note on the Settings page depends on this
    expect(slotKey("2026-11-11T08:00:00Z", "Asia/Tokyo", "2026-11-11T08:00")).toBe("2026-11-11T13:00");
  });

  test("a new time is due at its local time", () => {
    // characterisation: the note on the Settings page depends on this
    expect(slotKey("2026-11-11T11:00:00Z", TZ, "2026-11-11T08:00", ["08:00", "11:00"])).toBe("2026-11-11T11:00");
  });

  test("a large west move skips digests", () => {
    // characterisation: the note on the Settings page depends on this
    expect(slotKey("2026-11-11T16:00:00Z", "America/Los_Angeles", "2026-11-11T13:00")).toBeNull();
    expect(slotKey("2026-11-11T21:00:00Z", "America/Los_Angeles", "2026-11-11T13:00")).toBeNull();
    expect(slotKey("2026-11-12T16:00:00Z", "America/Los_Angeles", "2026-11-11T13:00")).toBe("2026-11-12T08:00");
  });
});
