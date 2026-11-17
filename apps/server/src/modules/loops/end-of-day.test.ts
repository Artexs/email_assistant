import { describe, expect, test } from "bun:test";

import { endOfLocalDay } from "./list";

// "By the end of the local day" of the brief: the first instant of the next local day, also on the days that change the clock.
describe("endOfLocalDay", () => {
  test.each([
    ["a winter day", "2026-11-20T07:00:00Z", "Europe/Warsaw", "2026-11-20T23:00:00.000Z"],
    ["a summer day", "2026-07-10T07:00:00Z", "Europe/Warsaw", "2026-07-10T22:00:00.000Z"],
    ["the day summer time ends (25 hours)", "2026-10-25T06:00:00Z", "Europe/Warsaw", "2026-10-25T23:00:00.000Z"],
    ["the day summer time starts (23 hours)", "2026-03-29T06:00:00Z", "Europe/Warsaw", "2026-03-29T22:00:00.000Z"],
    ["just before local midnight", "2026-11-20T22:59:59Z", "Europe/Warsaw", "2026-11-20T23:00:00.000Z"],
    ["the first second of the next local day", "2026-11-20T23:00:00Z", "Europe/Warsaw", "2026-11-21T23:00:00.000Z"],
    ["another zone", "2026-11-20T07:00:00Z", "America/New_York", "2026-11-21T05:00:00.000Z"],
    // Review 19 N8: the day after a repeated midnight starts at the first 00:00, not the second one.
    ["Havana, the next day repeats midnight", "2026-10-31T12:00:00Z", "America/Havana", "2026-11-01T04:00:00.000Z"],
    // Spring: there is no midnight, the day starts at the change.
    ["Havana, the next day has no midnight", "2026-03-07T12:00:00Z", "America/Havana", "2026-03-08T05:00:00.000Z"],
    ["Santiago, the next day has no midnight", "2026-09-05T12:00:00Z", "America/Santiago", "2026-09-06T04:00:00.000Z"],
  ])("%s", (_name, now, zone, end) => {
    expect(endOfLocalDay(new Date(now), zone).toISOString()).toBe(end);
  });
});
