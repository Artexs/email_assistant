import { describe, expect, test } from "bun:test";

import {
  compareLegalVersions,
  formatLegalVersion,
  isCanonicalLegalVersion,
  legalVersionCovers,
  nextLegalVersion,
  parseLegalVersion,
} from "./legal-version";

describe("parseLegalVersion", () => {
  test("T1 a bare date is counter 1", () => {
    expect(parseLegalVersion("2026-11-18")).toEqual({ date: "2026-11-18", counter: 1 });
  });

  test.each([
    ["2026-11-18.2", { date: "2026-11-18", counter: 2 }],
    ["2026-11-18-2", { date: "2026-11-18", counter: 2 }],
    ["2026-11-15.10", { date: "2026-11-15", counter: 10 }],
    ["2026-11-15-10", { date: "2026-11-15", counter: 10 }],
  ])("T2 %s has a counter, in the dot and the hyphen spelling", (text, expected) => {
    expect(parseLegalVersion(text)).toEqual(expected);
  });

  test.each([
    [null, "null"],
    ["", "empty"],
    ["zzzz", "garbage"],
    ["20261115", "no hyphens"],
    ["2099-1-1", "short month and day"],
    ["2026-02-30", "a day that does not exist"],
    ["2026-13-01", "month 13"],
    ["2026-11-15.", "a dot and no counter"],
    ["2026-11-15.x", "a counter that is not a number"],
    ["2026-11-15.0", "counter 0"],
    ["2026-11-15.1", "counter 1 (the bare date is counter 1)"],
    ["2026-11-15.02", "a leading zero"],
    ["2026-11-15-1", "hyphen counter 1"],
    [" 2026-11-16", "leading white space"],
    ["2026-11-16\n", "trailing newline"],
    ["2026-11-15.2.3", "two counters"],
    [`2026-11-15.${"9".repeat(30)}`, "a counter that is not a safe integer"],
  ])("T3 %p is not a version (%s)", (text) => {
    expect(parseLegalVersion(text)).toBeNull();
  });
});

describe("formatLegalVersion and isCanonicalLegalVersion", () => {
  test.each([
    [{ date: "2026-11-18", counter: 2 }, "2026-11-18.2"],
    [{ date: "2026-11-18", counter: 1 }, "2026-11-18"],
    [{ date: "2026-11-15", counter: 10 }, "2026-11-15.10"],
  ])("T4 %p is written as %s", (version, text) => {
    expect(formatLegalVersion(version)).toBe(text);
  });

  test.each([
    ["2026-11-18", true],
    ["2026-11-18.2", true],
    ["2026-11-18-2", false],
    ["2026-11-18.1", false],
    ["zzzz", false],
  ])("T4 isCanonicalLegalVersion(%s) is %p", (text, expected) => {
    expect(isCanonicalLegalVersion(text)).toBe(expected);
  });
});

describe("compareLegalVersions", () => {
  test("T5 orders by date, then by counter as a number", () => {
    const order = ["2026-11-15", "2026-11-15.2", "2026-11-15.9", "2026-11-15.10", "2026-11-16"].map((text) => {
      const version = parseLegalVersion(text);
      if (version === null) throw new Error(`${text} does not parse`);
      return version;
    });
    for (const [index, older] of order.entries()) {
      for (const [otherIndex, newer] of order.entries()) {
        expect(Math.sign(compareLegalVersions(older, newer))).toBe(Math.sign(index - otherIndex));
      }
    }
  });

  test("T5 the hyphen spelling equals the dot spelling", () => {
    const hyphen = parseLegalVersion("2026-11-18-2");
    const dot = parseLegalVersion("2026-11-18.2");
    if (hyphen === null || dot === null) throw new Error("a spelling does not parse");
    expect(compareLegalVersions(hyphen, dot)).toBe(0);
  });
});

describe("legalVersionCovers", () => {
  test.each([
    ["2026-11-15.10", "2026-11-15.9", true],
    ["2026-11-15", "2026-11-15.2", false],
    ["2026-11-15-2", "2026-11-15.2", true],
    ["2026-11-15.1", "2026-11-15", false],
    [null, "2026-11-15", false],
    ["2026-11-16", "garbage", false],
    ["garbage", "2026-11-16", false],
  ])("have %p since %p is %p", (have, since, expected) => {
    expect(legalVersionCovers(have, since)).toBe(expected);
  });
});

describe("nextLegalVersion", () => {
  test.each([
    ["2026-11-19", "2026-11-20", "2026-11-20"],
    ["2026-11-20", "2026-11-20", "2026-11-20.2"],
    ["2026-11-19-2", "2026-11-19", "2026-11-19.3"],
    ["2026-11-20.9", "2026-11-19", "2026-11-20.10"],
  ])("T6 (%s, today %s) is %s", (current, today, expected) => {
    expect(nextLegalVersion(current, today)).toBe(expected);
  });

  test.each([
    ["bad", "2026-11-20", "current is not a version"],
    ["2026-11-20", "bad", "today is not a date"],
    ["2026-11-20", "2026-11-21.2", "today has a counter"],
    ["2026-11-20", "2026-11-21-2", "today has a hyphen counter"],
  ])("T6 (%s, today %s) throws: %s", (current, today) => {
    expect(() => nextLegalVersion(current, today)).toThrow("nextLegalVersion");
  });
});
