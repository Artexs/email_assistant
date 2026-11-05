import { describe, expect, test } from "bun:test";

import { nextQuotaDayStart, QUOTA_TIMEZONE, quotaDayStart } from "./quota-day";

function iso(date: Date): string {
  return date.toISOString();
}

describe("quota day", () => {
  test("the time zone is America/Los_Angeles", () => {
    expect(QUOTA_TIMEZONE).toBe("America/Los_Angeles");
  });

  test("PST: the day starts at 08:00Z", () => {
    const before = new Date("2026-11-04T07:59:00Z");
    expect(iso(quotaDayStart(before, QUOTA_TIMEZONE))).toBe("2026-11-03T08:00:00.000Z");
    expect(iso(nextQuotaDayStart(before, QUOTA_TIMEZONE))).toBe("2026-11-04T08:00:00.000Z");
    const at = new Date("2026-11-04T08:00:00Z");
    expect(iso(quotaDayStart(at, QUOTA_TIMEZONE))).toBe("2026-11-04T08:00:00.000Z");
    expect(iso(nextQuotaDayStart(at, QUOTA_TIMEZONE))).toBe("2026-11-05T08:00:00.000Z");
  });

  test("the day daylight saving time ends is 25 hours long", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    expect(iso(quotaDayStart(now, QUOTA_TIMEZONE))).toBe("2026-11-01T07:00:00.000Z");
    expect(iso(nextQuotaDayStart(now, QUOTA_TIMEZONE))).toBe("2026-11-02T08:00:00.000Z");
  });

  test("the day daylight saving time starts is 23 hours long", () => {
    const now = new Date("2027-03-14T12:00:00Z");
    expect(iso(quotaDayStart(now, QUOTA_TIMEZONE))).toBe("2027-03-14T08:00:00.000Z");
    expect(iso(nextQuotaDayStart(now, QUOTA_TIMEZONE))).toBe("2027-03-15T07:00:00.000Z");
  });
});
