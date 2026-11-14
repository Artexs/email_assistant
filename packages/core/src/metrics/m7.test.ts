import { describe, expect, test } from "bun:test";

import { llmCallRow } from "./fixtures";
import { unitCost } from "./m7";

function week() {
  return [
    ...Array.from({ length: 1000 }, () => llmCallRow()),
    llmCallRow({ model: "gpt-6.1-terra" }),
    llmCallRow({ model: "gpt-6.1-terra" }),
    llmCallRow({ tokensIn: null, tokensOut: null }),
  ];
}

describe("unitCost", () => {
  test("prices the calls and adds hosting and backup per mailbox", () => {
    const cost = unitCost(week(), { mailboxes: 1 });
    expect(cost.llmCalls).toBe(1003);
    expect(cost.unpricedCalls).toBe(2);
    expect(cost.llmUsdWeek).toBeCloseTo(0.1436, 3);
    expect(cost.hostingUsdMonth).toBeCloseTo(0.355, 6);
    expect(cost.backupUsdMonth).toBe(0.05);
    expect(Math.abs(cost.perMailboxMonthUsd - ((0.1436 * 30) / 7 + 0.355 + 0.05))).toBeLessThan(0.001);
    expect(cost.targetUsd).toBe(5);
  });

  test("a call without a model is unpriced", () => {
    const cost = unitCost([llmCallRow({ model: null })], { mailboxes: 1 });
    expect(cost).toMatchObject({ llmCalls: 1, unpricedCalls: 1, llmUsdWeek: 0 });
  });

  test("zero mailboxes count as one", () => {
    expect(unitCost(week(), { mailboxes: 0 })).toEqual(unitCost(week(), { mailboxes: 1 }));
    expect(unitCost(week(), { mailboxes: 0 }).mailboxes).toBe(1);
  });

  test("the LLM cost splits over the mailboxes", () => {
    const one = unitCost(week(), { mailboxes: 1 });
    const two = unitCost(week(), { mailboxes: 2 });
    expect(two.perMailboxMonthUsd).toBeCloseTo((one.llmUsdWeek * 30) / 7 / 2 + 0.355 + 0.05, 9);
  });
});
