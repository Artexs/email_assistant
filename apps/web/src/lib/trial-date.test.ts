import { describe, expect, test } from "bun:test";

import { trialDateText } from "./trial-date";

describe("trialDateText", () => {
  test("the time zone moves the day", () => {
    expect(trialDateText("2026-11-30T23:30:00Z", "Europe/Warsaw")).toBe("1 December 2026");
  });

  test("UTC keeps the day", () => {
    expect(trialDateText("2026-11-30T12:00:00Z", "UTC")).toBe("30 November 2026");
  });
});
