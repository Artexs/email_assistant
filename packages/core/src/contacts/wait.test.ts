import { describe, expect, test } from "bun:test";

import { contactWaitDays, usualReplyDays } from "./wait";

describe("contactWaitDays", () => {
  test("1.5 times the median, rounded up to days", () => {
    expect(contactWaitDays(20, 5)).toBe(2);
  });

  test("at least 1 day", () => {
    expect(contactWaitDays(5, 5)).toBe(1);
    expect(contactWaitDays(0, 5)).toBe(1);
  });

  test("at most 7 days", () => {
    expect(contactWaitDays(100, 5)).toBe(7);
    expect(contactWaitDays(200, 9)).toBe(7);
  });

  test("a whole number of days does not round up", () => {
    expect(contactWaitDays(48, 5)).toBe(3);
  });

  test("below 5 samples or without a median there is no wait", () => {
    expect(contactWaitDays(20, 4)).toBeNull();
    expect(contactWaitDays(null, 7)).toBeNull();
  });
});

describe("usualReplyDays", () => {
  test("rounds to days, half up, between 1 and 60", () => {
    expect(usualReplyDays(30)).toBe(1);
    expect(usualReplyDays(10)).toBe(1);
    expect(usualReplyDays(47)).toBe(2);
    expect(usualReplyDays(60)).toBe(3);
    expect(usualReplyDays(24 * 400)).toBe(60);
  });
});
