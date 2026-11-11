import { describe, expect, test } from "bun:test";

import { activityQueryString, DEFAULT_FILTERS, filtersFromSearch, filtersToSearch } from "./activity-filters";

const MAILBOX = "6f1d6f2e-8a3b-4c5d-9e7f-0123456789ab";
const NOW = new Date("2026-11-11T12:00:00.000Z");

describe("filtersFromSearch", () => {
  test("empty search gives the defaults", () => {
    expect(filtersFromSearch("")).toEqual(DEFAULT_FILTERS);
  });

  test("reads the four keys", () => {
    expect(filtersFromSearch(`?category=action&range=30d&notRated=1&mailbox=${MAILBOX}`)).toEqual({
      mailboxId: MAILBOX,
      category: "action",
      range: "30d",
      notRated: true,
    });
  });

  test("unknown values fall back to the defaults", () => {
    expect(filtersFromSearch("?category=bogus&range=1y&mailbox=x&other=1")).toEqual(DEFAULT_FILTERS);
  });
});

describe("filtersToSearch", () => {
  test("defaults give an empty string", () => {
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe("");
  });

  test("round trip", () => {
    const sets = [
      { mailboxId: MAILBOX, category: "all", range: "7d", notRated: false },
      { mailboxId: null, category: "unsure", range: "90d", notRated: true },
      { mailboxId: MAILBOX, category: "action", range: "24h", notRated: true },
    ] as const;
    for (const filters of sets) expect(filtersFromSearch(filtersToSearch(filters))).toEqual(filters);
  });

  test("key order", () => {
    expect(filtersToSearch({ mailboxId: MAILBOX, category: "info", range: "24h", notRated: true })).toBe(
      `?mailbox=${MAILBOX}&category=info&range=24h&notRated=1`
    );
  });
});

describe("activityQueryString", () => {
  test("all filters and a cursor", () => {
    const params = new URLSearchParams(
      activityQueryString({ mailboxId: MAILBOX, category: "action", range: "24h", notRated: true }, NOW, "abc_-")
    );
    expect(params.get("since")).toBe("2026-11-10T12:00:00.000Z");
    expect(params.get("categories")).toBe("urgent,needs_reply,unsure");
    expect(params.get("notRated")).toBe("true");
    expect(params.get("mailboxId")).toBe(MAILBOX);
    expect(params.get("before")).toBe("abc_-");
  });

  test("defaults send only since (7 days)", () => {
    expect(activityQueryString(DEFAULT_FILTERS, NOW)).toBe("?since=2026-11-04T12%3A00%3A00.000Z");
  });

  test("one category", () => {
    const params = new URLSearchParams(activityQueryString({ ...DEFAULT_FILTERS, category: "spam" }, NOW));
    expect(params.get("categories")).toBe("spam");
  });
});
