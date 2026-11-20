import { describe, expect, test } from "bun:test";

import {
  formatClock,
  formatDay,
  isQuietTime,
  lateMin,
  localDateTime,
  localKey,
  localToInstant,
  QUIET_HOURS,
  quietEnd,
  quietHoursOf,
  startOfLocalDay,
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

describe("startOfLocalDay", () => {
  test.each([
    ["a normal day", "2026-11-20", "Europe/Warsaw", "2026-11-19T23:00:00.000Z"],
    ["midnight repeats in autumn: the first one", "2026-11-01", "America/Havana", "2026-11-01T04:00:00.000Z"],
    ["midnight is skipped in spring: the change", "2026-03-08", "America/Havana", "2026-03-08T05:00:00.000Z"],
    ["the same in Santiago", "2026-09-06", "America/Santiago", "2026-09-06T04:00:00.000Z"],
  ])("%s", (_name, date, zone, start) => {
    expect(startOfLocalDay(date, zone).toISOString()).toBe(start);
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

describe("lateMin", () => {
  test("12. minutes outside the quiet hours: 2 before 22:00 and 9 after 07:00 (Warsaw, November)", () => {
    expect(lateMin(new Date("2026-11-19T20:58:00Z"), new Date("2026-11-20T06:09:00Z"), TZ)).toBe(11);
  });

  test("a range inside the day counts every minute", () => {
    expect(lateMin(new Date("2026-11-20T09:45:00Z"), new Date("2026-11-20T10:00:00Z"), TZ)).toBe(15);
  });

  test("a range inside the quiet hours counts nothing, also when it starts after midnight", () => {
    expect(lateMin(new Date("2026-11-19T22:30:00Z"), new Date("2026-11-20T05:00:00Z"), TZ)).toBe(0);
    expect(lateMin(new Date("2026-11-20T02:00:00Z"), new Date("2026-11-20T03:00:00Z"), TZ)).toBe(0);
  });

  test("a range over two nights subtracts both", () => {
    // 2026-11-19 08:00Z (09:00) to 2026-11-21 08:00Z: 48 h minus two nights of 9 h.
    expect(lateMin(new Date("2026-11-19T08:00:00Z"), new Date("2026-11-21T08:00:00Z"), TZ)).toBe(30 * 60);
  });

  test("to before from is 0", () => {
    expect(lateMin(new Date("2026-11-20T10:00:00Z"), new Date("2026-11-20T09:00:00Z"), TZ)).toBe(0);
  });

  test("the spring night is 8 h long: 20:00Z to 06:00Z leaves 1 h before 21:00Z and 1 h after 05:00Z", () => {
    // The night starts 2027-03-27 21:00Z (22:00 CET) and ends 2027-03-28 05:00Z (07:00 CEST).
    expect(lateMin(new Date("2027-03-27T20:00:00Z"), new Date("2027-03-28T06:00:00Z"), TZ)).toBe(120);
  });

  test("the autumn night is 10 h long: 18:00Z to 07:00Z leaves 2 h before 20:00Z and 1 h after 06:00Z", () => {
    // The change back is 2026-10-25 03:00 CEST to 02:00 CET. The night starts 2026-10-24 20:00Z (22:00 CEST) and ends
    // 2026-10-25 06:00Z (07:00 CET): 10 quiet hours by the clock. 2 h + 1 h are outside it.
    expect(lateMin(new Date("2026-10-24T18:00:00Z"), new Date("2026-10-25T07:00:00Z"), TZ)).toBe(180);
    // A range that crosses the repeated local hour (02:00 to 03:00 happens twice) lies inside the night: all quiet.
    expect(lateMin(new Date("2026-10-25T00:30:00Z"), new Date("2026-10-25T02:30:00Z"), TZ)).toBe(0);
  });
});

// The quiet hours of one member (tests 1 to 4 of the stage).
describe("own quiet hours", () => {
  const night = { start: "23:00", end: "06:00" };
  // 2026-11-06 is CET (UTC+1): local HH:MM = UTC HH:MM + 1 h.
  const at = (utc: string): Date => new Date(`2026-11-06T${utc}:00Z`);

  test("1. hours 23:00–06:00: 22:30 is not quiet, 23:30 is, and the end is 06:00 the next day", () => {
    expect(isQuietTime(at("21:30"), TZ, night)).toBe(false); // 22:30
    expect(isQuietTime(at("22:30"), TZ, night)).toBe(true); // 23:30
    expect(iso(quietEnd(at("22:30"), TZ, night))).toBe("2026-11-07T05:00:00.000Z"); // 06:00 on the 7th
    // The default holds the 22:30 notice that the own hours let through.
    expect(isQuietTime(at("21:30"), TZ)).toBe(true);
  });

  test("2. hours 09:00–17:00 (day quiet): 12:00 is quiet, 18:00 is not", () => {
    const day = { start: "09:00", end: "17:00" };
    expect(isQuietTime(at("11:00"), TZ, day)).toBe(true); // 12:00
    expect(isQuietTime(at("17:00"), TZ, day)).toBe(false); // 18:00
    expect(iso(quietEnd(at("11:00"), TZ, day))).toBe("2026-11-06T16:00:00.000Z"); // 17:00 the same day
  });

  test("3. start equal to end is never quiet", () => {
    const none = { start: "10:00", end: "10:00" };
    for (const utc of ["00:00", "09:00", "12:00", "23:59"]) expect(isQuietTime(at(utc), TZ, none)).toBe(false);
    expect(lateMin(at("00:00"), at("12:00"), TZ, none)).toBe(720);
  });

  test("4. DST: the end of the default hours from 01:30 local is 07:00 local on the day of each change", () => {
    // 2026-03-29 spring forward: 01:30 CET (00:30Z) to 07:00 CEST (05:00Z) is 4 h 30 min of real time.
    const spring = new Date("2026-03-29T00:30:00Z");
    expect(localDateTime(spring, TZ).time).toBe("01:30");
    expect(iso(quietEnd(spring, TZ))).toBe("2026-03-29T05:00:00.000Z");
    expect(quietEnd(spring, TZ).getTime() - spring.getTime()).toBe(270 * 60_000);
    // 2026-10-25 fall back: the first 01:30 is CEST (23:30Z the day before); 07:00 CET is 06:00Z: 6 h 30 min.
    const autumn = new Date("2026-10-24T23:30:00Z");
    expect(localDateTime(autumn, TZ).time).toBe("01:30");
    expect(iso(quietEnd(autumn, TZ))).toBe("2026-10-25T06:00:00.000Z");
    expect(quietEnd(autumn, TZ).getTime() - autumn.getTime()).toBe(390 * 60_000);
  });

  test("lateMin takes the own hours: the same wait is late for 22:00–07:00 and not for 21:00–08:00", () => {
    // Mail at 21:30 local (20:30Z), notice at 08:00 local (07:00Z).
    const from = at("20:30");
    const to = new Date("2026-11-07T07:00:00Z");
    expect(lateMin(from, to, TZ, { start: "21:00", end: "08:00" })).toBe(0);
    expect(lateMin(from, to, TZ)).toBe(30 + 60);
  });

  test("quietHoursOf: both null is the default; a pair is taken as it is", () => {
    expect(quietHoursOf(null, null)).toBe(QUIET_HOURS);
    expect(quietHoursOf("23:00", "06:00")).toEqual(night);
    expect(quietHoursOf("10:00", "10:00")).toEqual({ start: "10:00", end: "10:00" });
    // The table has a check that both columns are null or both set; a half pair would be a bug, never a half range.
    expect(quietHoursOf("23:00", null)).toBe(QUIET_HOURS);
    expect(quietHoursOf(null, "06:00")).toBe(QUIET_HOURS);
  });
});

// The end time of the own hours can fall in a spring gap or in the autumn hour that repeats, also in
// zones west of UTC. `quietEnd` is always after `now`, never early and never past the end by more than the gap.
describe("quietEnd on a daylight-saving day", () => {
  const NY = "America/New_York";

  test("localToInstant: a gap time gives the instant after the change in a zone west of UTC, as in one east of it", () => {
    // 2026-03-08 02:30 does not exist in New York: the clock goes from 02:00 EST (07:00Z) to 03:00 EDT.
    expect(iso(localToInstant("2026-03-08", "02:30", NY))).toBe("2026-03-08T07:30:00.000Z");
    expect(iso(localToInstant("2026-03-29", "02:30", TZ))).toBe("2026-03-29T01:30:00.000Z");
  });

  test("localToInstant: an ambiguous time gives the later instant in a zone west of UTC", () => {
    // 2026-11-01 01:30 shows twice in New York: 05:30Z (EDT) and 06:30Z (EST).
    expect(iso(localToInstant("2026-11-01", "01:30", NY))).toBe("2026-11-01T06:30:00.000Z");
  });

  test("an end time in the New York gap: the hold ends at the change, not in the past (reviewer case)", () => {
    // Hours 00:00–02:00, 01:05 EST: the end 02:00 is the change itself, 07:00Z.
    expect(iso(quietEnd(new Date("2026-03-08T06:05:00Z"), NY, { start: "00:00", end: "02:00" }))).toBe(
      "2026-03-08T07:00:00.000Z"
    );
    // End 02:30 does not exist: the wall clock jumps from 01:59 to 03:00, so the quiet hours end at 03:00 EDT (07:00Z).
    expect(iso(quietEnd(new Date("2026-03-08T06:05:00Z"), NY, { start: "00:00", end: "02:30" }))).toBe(
      "2026-03-08T07:00:00.000Z"
    );
  });

  test("an end time in the Warsaw gap ends at the change too", () => {
    // 2026-03-29: 02:00 CET (01:00Z) becomes 03:00 CEST.
    expect(iso(quietEnd(new Date("2026-03-29T00:10:00Z"), TZ, { start: "00:00", end: "02:30" }))).toBe(
      "2026-03-29T01:00:00.000Z"
    );
  });

  test("an end time in the autumn hour: the first pass ends at the first time, the second pass at the second", () => {
    const quiet = { start: "22:00", end: "01:30" };
    // 2026-11-01 New York: 05:10Z is 01:10 EDT, 06:10Z is 01:10 EST.
    expect(iso(quietEnd(new Date("2026-11-01T05:10:00Z"), NY, quiet))).toBe("2026-11-01T05:30:00.000Z");
    expect(iso(quietEnd(new Date("2026-11-01T06:10:00Z"), NY, quiet))).toBe("2026-11-01T06:30:00.000Z");
    // The same in Warsaw, 2026-10-25: 00:10Z is 02:10 CEST, 01:10Z is 02:10 CET.
    const warsaw = { start: "22:00", end: "02:30" };
    expect(iso(quietEnd(new Date("2026-10-25T00:10:00Z"), TZ, warsaw))).toBe("2026-10-25T00:30:00.000Z");
    expect(iso(quietEnd(new Date("2026-10-25T01:10:00Z"), TZ, warsaw))).toBe("2026-10-25T01:30:00.000Z");
  });

  test("the 44 bad cases of the review: New York 2026-03-08 with the end 02:00 or 02:30 are all after now", () => {
    const starts = ["00:00", "01:00", "01:30", "02:00", "02:30", "03:00", "22:00", "23:00", "09:00"];
    let quiet = 0;
    for (const start of starts) {
      for (const end of ["02:00", "02:30"]) {
        for (let t = Date.parse("2026-03-07T12:00:00Z"); t < Date.parse("2026-03-09T12:00:00Z"); t += 15 * 60_000) {
          const now = new Date(t);
          if (!isQuietTime(now, NY, { start, end })) continue;
          quiet += 1;
          expect(quietEnd(now, NY, { start, end }).getTime()).toBeGreaterThan(t);
        }
      }
    }
    expect(quiet).toBeGreaterThan(44);
  });

  // The zones and the days of 2026 with a change (Lord Howe moves by 30 minutes).
  const changeDays: [string, string[]][] = [
    ["America/New_York", ["2026-03-08", "2026-11-01"]],
    ["Europe/Warsaw", ["2026-03-29", "2026-10-25"]],
    ["Australia/Sydney", ["2026-04-05", "2026-10-04"]],
    ["Australia/Lord_Howe", ["2026-04-05", "2026-10-04"]],
  ];

  test("every zone and change day: after now, not early, never past the end by more than the change, at most window + 1 h", () => {
    let checked = 0;
    for (const [zone, days] of changeDays) {
      for (const day of days) {
        const from = Date.parse(`${day}T00:00:00Z`) - 18 * 3_600_000;
        for (const start of ["20:00", "22:00", "00:00", "01:00"]) {
          for (const end of ["00:00", "00:30", "01:00", "01:30", "02:00", "02:30", "03:00", "03:30", "06:00"]) {
            if (start === end) continue;
            const quiet = { start, end };
            const [sh, sm] = start.split(":").map(Number) as [number, number];
            const [eh, em] = end.split(":").map(Number) as [number, number];
            const spanMin = (eh * 60 + em - sh * 60 - sm + 1440) % 1440;
            for (let t = from; t < from + 48 * 3_600_000; t += 30 * 60_000) {
              const now = new Date(t);
              if (!isQuietTime(now, zone, quiet)) continue;
              checked += 1;
              const end2 = quietEnd(now, zone, quiet);
              const hold = end2.getTime() - t;
              expect(hold).toBeGreaterThan(0);
              expect(hold).toBeLessThanOrEqual((spanMin + 60) * 60_000);
              // At the end the wall clock is out of the quiet hours, and one minute before it is quiet (or the change itself).
              expect(isQuietTime(end2, zone, quiet)).toBe(false);
              expect(isQuietTime(new Date(end2.getTime() - 60_000), zone, quiet)).toBe(true);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    // The loop is CPU bound; on a loaded machine it needs more than the default 5 s.
  }, 60_000);
});

describe("localToInstant and startOfLocalDay on the change days of Warsaw", () => {
  test.each([
    ["a winter day", "2026-03-02", "09:00", "2026-03-02T08:00:00.000Z"],
    ["a time in the spring gap: the wall clock reads 03:30", "2026-03-29", "02:30", "2026-03-29T01:30:00.000Z"],
    ["a time in the autumn hour that repeats: the later instant", "2026-10-25", "02:30", "2026-10-25T01:30:00.000Z"],
  ])("%s", (_name, date, time, instant) => {
    expect(iso(localToInstant(date, time, TZ))).toBe(instant);
  });

  test("the first instant of the autumn change day is local midnight", () => {
    expect(iso(startOfLocalDay("2026-10-25", TZ))).toBe("2026-10-24T22:00:00.000Z");
  });
});

describe("lateMin at the edge of the range", () => {
  const from = new Date("2026-03-02T12:00:00Z");

  test.each([
    ["to equal to from", "2026-03-02T12:00:00Z", 0],
    ["to one minute before from", "2026-03-02T11:59:00Z", 0],
    ["to one minute after from", "2026-03-02T12:01:00Z", 1],
  ])("%s", (_name, to, minutes) => {
    expect(lateMin(from, new Date(to), TZ)).toBe(minutes);
  });
});

describe("a quiet window that does not wrap midnight", () => {
  const window = { start: "12:00", end: "14:00" };
  const at = (time: string) => new Date(`2026-11-20T${time}:00Z`); // Warsaw is one hour ahead of UTC

  test.each([
    ["one minute before the start", "10:59", false],
    ["the start", "11:00", true],
    ["inside", "12:00", true],
    ["one minute before the end", "12:59", true],
    ["the end", "13:00", false],
  ])("isQuietTime %s", (_name, time, quiet) => {
    expect(isQuietTime(at(time), TZ, window)).toBe(quiet);
  });

  test("lateMin takes the window off a range that spans it", () => {
    expect(lateMin(at("09:00"), at("15:00"), TZ, window)).toBe(240);
  });
});
