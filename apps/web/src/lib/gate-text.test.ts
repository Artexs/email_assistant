import { describe, expect, test } from "bun:test";

import { formatConfidence, formatPercent, formatPrecision, gateText } from "./gate-text";

describe("formatters", () => {
  test("formatPercent", () => {
    expect(formatPercent(0.985)).toBe("98.5");
    expect(formatPercent(1)).toBe("100");
    expect(formatPercent(0.98)).toBe("98");
  });

  test("formatPrecision rounds down", () => {
    expect(formatPrecision(0.9796)).toBe("97.9");
    expect(formatPrecision(0.985)).toBe("98.5");
    expect(formatPrecision(1)).toBe("100");
    expect(formatPrecision(0.836)).toBe("83.6");
  });

  test("formatConfidence", () => {
    expect(formatConfidence(0.5)).toBe("0.5");
    expect(formatConfidence(0.85)).toBe("0.85");
  });
});

describe("gateText", () => {
  test("go", () => {
    const gate = { decision: "go", precision: 0.985, kept: 62, atConfidence: 0.85, threshold: 0.85 } as const;
    expect(gateText(gate, 0.98, 30)).toEqual({
      key: "gate_go",
      vars: { precision: "98.5", kept: 62, at: "0.85", bar: "98" },
    });
  });

  test("no-go", () => {
    const gate = { decision: "no-go", precision: 0.836, kept: 55, atConfidence: 0.5, threshold: null } as const;
    expect(gateText(gate, 0.98, 30)).toEqual({
      key: "gate_no_go",
      vars: { precision: "83.6", kept: 55, at: "0.5", bar: "98" },
    });
  });

  test("a failing precision never shows the bar", () => {
    const gate = { decision: "no-go", precision: 0.9796, kept: 55, atConfidence: 0.5, threshold: null } as const;
    expect(gateText(gate, 0.98, 30).vars.precision).toBe("97.9");
  });

  test("too few", () => {
    const gate = { decision: "no-go: too few", precision: null, kept: 12, atConfidence: 0.5, threshold: null } as const;
    expect(gateText(gate, 0.98, 30)).toEqual({
      key: "gate_too_few",
      vars: { kept: 12, minKept: 30, at: "0.5" },
    });
  });
});
