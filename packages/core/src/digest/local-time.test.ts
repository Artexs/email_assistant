import { describe, expect, test } from "bun:test";

import {
  formatClock,
  formatDay,
  isQuietTime,
  localDateTime,
  localKey,
  localToInstant,
  QUIET_HOURS,
  quietEnd,
} from "./local-time";

const TZ = "Europe/Warsaw";

function iso(date: Date): string {
  return date.toISOString();
}

describe("localDateTime and localKey", () => {
  test("read the local parts", () => {
    const at = new Date("2026-11-06T07:00:00Z");
    expect(localDateTime(at, TZ)).toEqual({ date: "2026-11-06", time: "08:00", weekday: 5 });
    expect(localKey(at, TZ)).toBe("2026-11-06T08:00");
  });
});

describe("localToInstant", () => {
  test("a normal time", () => {
    expect(iso(localToInstant("2026-11-06", "08:00", TZ))).toBe("2026-11-06T07:00:00.000Z");
    expect(iso(localToInstant("2026-07-01", "08:00", TZ))).toBe("2026-07-01T06:00:00.000Z");
  });

  test("a time in the spring gap gives the wall clock one hour later", () => {
    const result = localToInstant("2027-03-28", "02:30", TZ);
    expect(iso(result)).toBe("2027-03-28T01:30:00.000Z");
    expect(localDateTime(result, TZ).time).toBe("03:30");
  });

  test("an ambiguous time in autumn gives the later instant", () => {
    expect(iso(localToInstant("2026-10-25", "02:30", TZ))).toBe("2026-10-25T01:30:00.000Z");
  });
});

describe("formatClock and formatDay", () => {
  const now = new Date("2026-11-06T07:00:00Z");

  test("same local date: HH:MM", () => {
    expect(formatClock(new Date("2026-11-06T06:55:00Z"), TZ, now, "en")).toBe("07:55");
  });

  test("same year: D Mon HH:MM", () => {
    expect(formatClock(new Date("2026-11-04T22:55:00Z"), TZ, now, "en")).toBe("4 Nov 23:55");
  });

  test("other year: D Mon YYYY HH:MM", () => {
    expect(formatClock(new Date("2025-12-31T10:00:00Z"), TZ, now, "en")).toBe("31 Dec 2025 11:00");
  });

  test("formatDay", () => {
    expect(formatDay(now, TZ, "en")).toBe("Fri 6 Nov");
  });
});

describe("formatClock and formatDay in Polish and English", () => {
  const warsaw = "Europe/Warsaw";
  const now = new Date("2026-11-14T11:00:00Z");

  test("pl", () => {
    expect(formatClock(new Date("2026-11-14T11:30:00Z"), warsaw, now, "pl")).toBe("12:30");
    expect(formatClock(new Date("2026-11-13T11:30:00Z"), warsaw, now, "pl")).toBe("13 lis 12:30");
    expect(formatClock(new Date("2025-11-13T11:30:00Z"), warsaw, now, "pl")).toBe("13 lis 2025 12:30");
    expect(formatDay(new Date("2026-11-14T11:30:00Z"), warsaw, "pl")).toBe("sob. 14 lis");
  });

  test("en", () => {
    expect(formatClock(new Date("2026-11-13T11:30:00Z"), warsaw, now, "en")).toBe("13 Nov 12:30");
    expect(formatDay(new Date("2026-11-14T11:30:00Z"), warsaw, "en")).toBe("Sat 14 Nov");
  });
});

describe("isQuietTime", () => {
  // 2026-11-06 is CET (UTC+1): local HH:MM = UTC HH:MM + 1 h.
  const at = (utc: string): Date => new Date(`2026-11-06T${utc}:00Z`);

  test("the default quiet hours go over midnight", () => {
    expect(QUIET_HOURS).toEqual({ start: "22:00", end: "07:00" });
    expect(isQuietTime(at("20:59"), TZ)).toBe(false); // 21:59
    expect(isQuietTime(at("21:00"), TZ)).toBe(true); // 22:00
    expect(isQuietTime(at("02:00"), TZ)).toBe(true); // 03:00
    expect(isQuietTime(at("05:59"), TZ)).toBe(true); // 06:59
    expect(isQuietTime(at("06:00"), TZ)).toBe(false); // 07:00
  });

  test("start equal to end is never quiet", () => {
    const quiet = { start: "09:00", end: "09:00" };
    expect(isQuietTime(at("08:00"), TZ, quiet)).toBe(false);
    expect(isQuietTime(at("12:00"), TZ, quiet)).toBe(false);
  });

  test("a range inside one day", () => {
    const quiet = { start: "01:00", end: "05:00" };
    expect(isQuietTime(at("02:00"), TZ, quiet)).toBe(true); // 03:00
    expect(isQuietTime(at("04:00"), TZ, quiet)).toBe(false); // 05:00
  });
});

describe("quietEnd", () => {
  test("before midnight: 07:00 on the next local date", () => {
    expect(iso(quietEnd(new Date("2026-11-06T21:30:00Z"), TZ))).toBe("2026-11-07T06:00:00.000Z");
  });

  test("after midnight: 07:00 on the same local date", () => {
    expect(iso(quietEnd(new Date("2026-11-07T05:59:00Z"), TZ))).toBe("2026-11-07T06:00:00.000Z");
  });

  test("outside the quiet hours: the same instant", () => {
    const at = new Date("2026-11-06T11:00:00Z");
    expect(iso(quietEnd(at, TZ))).toBe(iso(at));
  });

  test("the spring night", () => {
    expect(iso(quietEnd(new Date("2027-03-27T22:00:00Z"), TZ))).toBe("2027-03-28T05:00:00.000Z");
  });
});
