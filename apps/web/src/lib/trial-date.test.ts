import { afterEach, describe, expect, test } from "bun:test";

import { setLocaleForTest } from "../i18n";
import { trialDateText } from "./trial-date";

afterEach(() => setLocaleForTest("en"));

describe("trialDateText", () => {
  test("the time zone moves the day", () => {
    expect(trialDateText("2026-11-30T23:30:00Z", "Europe/Warsaw")).toBe("1 December 2026");
  });

  test("UTC keeps the day", () => {
    expect(trialDateText("2026-11-30T12:00:00Z", "UTC")).toBe("30 November 2026");
  });

  test("a Polish panel gets a Polish month", () => {
    setLocaleForTest("pl");
    expect(trialDateText("2026-12-01T10:00:00.000Z", "Europe/Warsaw")).toBe("1 grudnia 2026");
  });
});
