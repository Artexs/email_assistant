import { afterEach, describe, expect, test } from "bun:test";

import { setLocaleForTest } from "../i18n";

import { formatFixed, formatNumber, formatTrimmed, formatUsd, percentOf, wholePercent } from "./format-number";

afterEach(() => setLocaleForTest("en"));

describe("format-number, English (the output before the move)", () => {
  test("fixed and trimmed decimals", () => {
    expect(formatFixed(0.41, 2)).toBe("0.41");
    expect(formatFixed(12, 2)).toBe("12.00");
    expect(formatFixed(0.1234, 4)).toBe("0.1234");
    expect(formatTrimmed(0.991 * 100, 1)).toBe("99.1");
    expect(formatTrimmed(0.9, 0)).toBe("1");
    expect(formatTrimmed(97.5, 1)).toBe("97.5");
    expect(formatTrimmed(90, 1)).toBe("90");
    expect(formatNumber(0.7)).toBe("0.7");
    expect(formatNumber(98.9)).toBe("98.9");
  });

  test("dollars", () => {
    expect(formatUsd(0.41, 2)).toBe("$0.41");
    expect(formatUsd(0.1234, 4)).toBe("$0.1234");
  });

  test("percent rounding", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(0, 5)).toBe(0);
    expect(wholePercent(0.9449)).toBe(94);
    expect(wholePercent(0.945)).toBe(95);
  });
});

describe("format-number, Polish", () => {
  test("the decimal mark is a comma", () => {
    setLocaleForTest("pl");
    expect(formatFixed(0.41, 2)).toBe("0,41");
    expect(formatFixed(12, 2)).toBe("12,00");
    expect(formatTrimmed(99.1, 1)).toBe("99,1");
    expect(formatTrimmed(90, 1)).toBe("90");
    expect(formatNumber(0.7)).toBe("0,7");
    expect(formatNumber(98.9)).toBe("98,9");
    expect(formatNumber(3)).toBe("3");
  });

  test("dollars read as 'amount USD'", () => {
    setLocaleForTest("pl");
    expect(formatUsd(0.41, 2)).toBe("0,41 USD");
    expect(formatUsd(0.1234, 4)).toBe("0,1234 USD");
  });
});
