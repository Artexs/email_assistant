import { describe, expect, test } from "bun:test";

import { wilsonInterval } from "../triage/metrics";

import { gateRow } from "./fixtures";
import { autoEvidence, EVIDENCE_MIN_LABELS } from "./m8";

describe("autoEvidence", () => {
  test("adds the Wilson lower bound of the precision and passes recall through", () => {
    const [row] = autoEvidence([gateRow({ precision: 0.97, kept: 41, recall: 0.62 })]);
    expect(row?.wilsonLower).toBe(wilsonInterval(40, 41).lower);
    expect(Math.abs((row?.wilsonLower ?? 0) - 0.874)).toBeLessThan(0.002);
    expect(row?.recall).toBe(0.62);
  });

  test("no precision or no labels → null", () => {
    const rows = autoEvidence([
      gateRow({ precision: null, kept: 0, decision: "no-go: too few" }),
      gateRow({ precision: 1, kept: 0 }),
    ]);
    expect(rows.map((row) => row.wilsonLower)).toEqual([null, null]);
  });

  test("keeps the input order and the fields of each row", () => {
    const input = [gateRow({ category: "spam" }), gateRow({ category: "urgent", auto: false })];
    expect(autoEvidence(input).map((row) => [row.category, row.auto])).toEqual([
      ["spam", true],
      ["urgent", false],
    ]);
    expect(EVIDENCE_MIN_LABELS).toBe(30);
  });
});
