import { describe, expect, test } from "bun:test";

import { addDays, dayNumberOf, formatDay, isRealDate, parseDay } from "./calendar-days";

describe("isRealDate", () => {
  test.each([
    [2026, 2, 29, false],
    [2028, 2, 29, true],
    [1900, 2, 29, false],
    [2000, 2, 29, true],
    [2026, 4, 31, false],
    [2026, 13, 1, false],
    [2026, 0, 1, false],
    [2026, 1, 0, false],
    [2026, 12, 31, true],
    [2026, 1, 1, true],
    [2026, 12, 32, false],
    [50, 1, 1, false],
    [100, 1, 1, true],
  ])("%i-%i-%i is %p", (year, month, day, expected) => {
    expect(isRealDate(year, month, day)).toBe(expected);
  });
});

describe("formatDay", () => {
  test.each([
    [2026, 3, 5, "2026-03-05"],
    [987, 11, 22, "0987-11-22"],
    [2026, 12, 31, "2026-12-31"],
  ])("%i, %i, %i is %s", (year, month, day, expected) => {
    expect(formatDay(year, month, day)).toBe(expected);
  });
});

describe("parseDay", () => {
  test("a real date gives its parts", () => {
    expect(parseDay("2028-02-29")).toEqual({ year: 2028, month: 2, day: 29 });
  });

  test.each(["2026-02-29", "2026-3-05", "x2026-03-05", "2026-03-05x", "2026-03-05\n", " 2026-03-05", ""])(
    "%j is not a date",
    (text) => {
      expect(parseDay(text)).toBeUndefined();
    }
  );
});

describe("dayNumberOf and addDays", () => {
  test("a text that is not a real date throws with the text", () => {
    expect(() => dayNumberOf("2026-02-30")).toThrow("not a date: 2026-02-30");
    expect(() => addDays("2026-02-30", 1)).toThrow("not a date: 2026-02-30");
  });

  test("a real date moves by whole days", () => {
    expect(addDays("2028-02-28", 2)).toBe("2028-03-01");
    expect(dayNumberOf("1970-01-02")).toBe(1);
  });
});
