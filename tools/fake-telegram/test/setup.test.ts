import { isQuietTime } from "@ea/core";
import { expect, test } from "bun:test";

import { timeZoneOutsideQuietHours } from "./setup";

test("the chosen time zone is outside quiet hours at every hour of the day", () => {
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    const at = new Date(Date.UTC(2026, 10, 7, 0, minutes));
    expect(isQuietTime(at, timeZoneOutsideQuietHours(at))).toBe(false);
  }
});

test("at 21:04 UTC (22:04 in Europe/Warsaw) the default org zone is quiet and the chosen one is not", () => {
  const at = new Date("2026-11-07T21:04:00Z");
  expect(isQuietTime(at, "Europe/Warsaw")).toBe(true);
  expect(isQuietTime(at, timeZoneOutsideQuietHours(at))).toBe(false);
});
