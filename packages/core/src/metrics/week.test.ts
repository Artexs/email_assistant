import { describe, expect, test } from "bun:test";

import { addWorkingDays, lastFinishedWeek, previousWeekStart, weekRange, weekStartOf } from "./week";

const TZ = "Europe/Warsaw";
const at = (iso: string): Date => new Date(iso);

describe("weekStartOf", () => {
  test("gives the local Monday", () => {
    expect(weekStartOf(at("2026-11-18T12:00:00Z"), TZ)).toBe("2026-11-16");
  });

  test("Sunday 23:30 local is still the old week", () => {
    expect(weekStartOf(at("2026-11-15T22:30:00Z"), TZ)).toBe("2026-11-09");
  });

  test("Monday 00:30 local starts the new week", () => {
    expect(weekStartOf(at("2026-11-15T23:30:00Z"), TZ)).toBe("2026-11-16");
  });
});

describe("weekRange", () => {
  test("a normal week runs Monday 00:00 to the next Monday 00:00 local", () => {
    const { start, end } = weekRange("2026-11-16", TZ);
    expect(start.toISOString()).toBe("2026-11-15T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-22T23:00:00.000Z");
  });

  test("the week of the autumn change has 169 hours", () => {
    const { start, end } = weekRange("2026-10-19", TZ);
    expect(start.toISOString()).toBe("2026-10-18T22:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(169);
  });

  test("the week of the spring change has 167 hours", () => {
    const { start, end } = weekRange("2026-03-23", TZ);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(167);
  });
});

describe("previous and last finished week", () => {
  test("previousWeekStart goes back 7 days across a month", () => {
    expect(previousWeekStart("2026-11-02")).toBe("2026-10-26");
  });

  test("lastFinishedWeek on a Monday is the week before", () => {
    expect(lastFinishedWeek(at("2026-11-16T08:00:00Z"), TZ)).toBe("2026-11-09");
  });
});

describe("addWorkingDays", () => {
  test("Friday + 1 is Monday at the same clock time", () => {
    expect(addWorkingDays(at("2026-11-20T09:00:00Z"), 1, TZ).toISOString()).toBe("2026-11-23T09:00:00.000Z");
  });

  test("Saturday + 1 is Monday", () => {
    expect(addWorkingDays(at("2026-11-21T09:00:00Z"), 1, TZ).toISOString()).toBe("2026-11-23T09:00:00.000Z");
  });

  test("Sunday + 1 is Monday", () => {
    expect(addWorkingDays(at("2026-11-22T09:00:00Z"), 1, TZ).toISOString()).toBe("2026-11-23T09:00:00.000Z");
  });

  test("Wednesday + 3 skips the weekend", () => {
    expect(addWorkingDays(at("2026-11-18T09:00:00Z"), 3, TZ).toISOString()).toBe("2026-11-23T09:00:00.000Z");
  });

  test("+ 0 is the same instant", () => {
    const start = at("2026-11-18T09:00:00Z");
    expect(addWorkingDays(start, 0, TZ).getTime()).toBe(start.getTime());
  });

  test("keeps the local clock time across the autumn change", () => {
    // Friday 2026-10-23 10:00 local (UTC+2) + 1 working day = Monday 2026-10-26 10:00 local (UTC+1).
    expect(addWorkingDays(at("2026-10-23T08:00:00Z"), 1, TZ).toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });
});
