import { describe, expect, test } from "bun:test";

import { WEEKLY_DEFAULT_TIME, weeklySlot } from "./weekly-report";

describe("weeklySlot", () => {
  test("the first digest time from 07:00 on", () => {
    expect(weeklySlot(["06:30", "09:00", "18:00"])).toBe("09:00");
    expect(weeklySlot(["18:00", "07:00", "09:00"])).toBe("07:00");
  });

  test("no digest time, or none from 07:00 on: the default", () => {
    expect(weeklySlot([])).toBe(WEEKLY_DEFAULT_TIME);
    expect(weeklySlot(["06:00"])).toBe("08:00");
  });
});
