import { describe, expect, test } from "bun:test";

import { E3_ESTIMATE_USD_PER_MAIL, costToRun, pilotCost, type PilotCost } from "./cost-model";
import { unitCost } from "./m7";

const block: PilotCost = {
  measuredOn: "2026-01-01",
  weeks: ["2025-12-01"],
  triagedMails: 1000,
  llmUsd: 0.5,
  llmCalls: 1200,
  unpricedCalls: 0,
  models: ["m"],
};

describe("costToRun", () => {
  test("measured: LLM from the pilot, hosting and backup shares", () => {
    const cost = costToRun(100, { pilot: block });
    expect(cost.llmUsd).toBeCloseTo(1.5, 6);
    expect(cost.hostingUsd).toBeCloseTo(0.355, 6);
    expect(cost.backupUsd).toBeCloseTo(0.05, 6);
    expect(cost.totalUsd).toBeCloseTo(1.905, 6);
    expect(cost.basis).toBe("measured");
  });

  test("hosting follows the mailboxes per host", () => {
    expect(costToRun(100, { pilot: block, mailboxesPerHost: 5 }).hostingUsd).toBeCloseTo(1.42, 6);
  });

  test("estimate under 100 triaged mails or over 5% unpriced calls", () => {
    for (const pilot of [
      { ...block, triagedMails: 99 },
      { ...block, unpricedCalls: 61 },
    ]) {
      const cost = costToRun(100, { pilot });
      expect(cost.basis).toBe("estimate");
      expect(cost.llmUsd).toBeCloseTo(E3_ESTIMATE_USD_PER_MAIL * 100 * 30, 6);
      expect(cost.llmUsd).toBeCloseTo(0.429, 6);
    }
    expect(costToRun(100, { pilot: { ...block, unpricedCalls: 60 } }).basis).toBe("measured");
    expect(costToRun(100, { pilot: { ...block, triagedMails: 100 } }).basis).toBe("measured");
  });

  test("a volume or host size at or under 0 throws RangeError", () => {
    expect(() => costToRun(0)).toThrow(RangeError);
    expect(() => costToRun(-1)).toThrow(RangeError);
    expect(() => costToRun(50, { mailboxesPerHost: 0 })).toThrow(RangeError);
  });

  test("unitCost and costToRun share hosting and backup at the default host size", () => {
    const unit = unitCost([], { mailboxes: 1 });
    const cost = costToRun(100);
    expect(unit.hostingUsdMonth).toBeCloseTo(cost.hostingUsd, 6);
    expect(unit.backupUsdMonth).toBeCloseTo(cost.backupUsd, 6);
  });

  test("the pilot block is the sum of the four weeks of pilot-cost.md", () => {
    expect(pilotCost.weeks).toHaveLength(4);
    expect(pilotCost.triagedMails).toBe(6 + 5 + 26 + 50);
    expect(pilotCost.llmUsd).toBeCloseTo(0.0658 + 0.0256, 6);
    expect(pilotCost.llmCalls).toBe(195 + 81);
  });
});
