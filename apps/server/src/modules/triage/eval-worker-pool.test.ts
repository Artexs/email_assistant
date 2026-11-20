import { describe, expect, test } from "bun:test";

import { LlmBlockedError } from "../../platform/llm";

import { type CaseResult, runEval } from "./eval";
import { firstEstimateUsd } from "./eval-pool";
import { answer, fakeLlm, makeCase, harness, opts, soft, delayedLlm, idCases, fixedCost } from "./eval.test-helper";

describe("runEval worker pool", () => {
  test("concurrency 4 gives the report of concurrency 1, with at most 4 calls in flight", async () => {
    const cases = idCases(12);
    // The first cases answer last, so the finish order is not the input order.
    const plan = (id: string) => ({
      ms: 25 - Number(id.slice(1)) * 2,
      step: answer(Number(id.slice(1)) % 2 ? "urgent" : "info"),
    });
    const one = delayedLlm(plan);
    const four = delayedLlm(plan);
    const sequential = await runEval(harness().deps(one.llm), { ...opts, cases });
    const parallel = await runEval(harness().deps(four.llm), { ...opts, cases, concurrency: 4 });
    expect(JSON.stringify(parallel.cases)).toBe(JSON.stringify(sequential.cases));
    expect(JSON.stringify(parallel.predictions)).toBe(JSON.stringify(sequential.predictions));
    expect(one.maxInFlight()).toBe(1);
    expect(four.maxInFlight()).toBe(4);
  });

  test("onResult follows the finish order, the report the input order", async () => {
    const cases = idCases(4);
    const { llm } = delayedLlm((id) => ({ ms: 40 - Number(id.slice(1)) * 10, step: answer("info") }));
    const finished: string[] = [];
    const deps = {
      ...harness().deps(llm),
      onResult: async (result: CaseResult) => {
        finished.push(result.id);
      },
    };
    const report = await runEval(deps, { ...opts, cases, concurrency: 4 });
    expect(finished).toEqual(["c03", "c02", "c01", "c00"]);
    expect(report.cases.map((c) => c.id)).toEqual(["c00", "c01", "c02", "c03"]);
  });

  test("3 errors in a row in finish order stop the run: no call starts after the stop", async () => {
    const cases = idCases(12);
    const { llm, started } = delayedLlm((id) => ({
      ms: 5,
      step: Number(id.slice(1)) >= 5 ? soft() : answer("info"),
    }));
    let errors = 0;
    let startedAtStop = -1;
    const deps = {
      ...harness().deps(llm),
      onResult: async (result: CaseResult) => {
        if (result.errorCode !== null) errors += 1;
        if (errors === 3 && startedAtStop < 0) startedAtStop = started.length;
      },
    };
    const report = await runEval(deps, { ...opts, retries: 0, cases, concurrency: 2 });
    expect(report.complete).toBe(false);
    expect(report.stoppedReason).toContain("soft errors in a row");
    expect(startedAtStop).toBeGreaterThan(0);
    expect(started).toHaveLength(startedAtStop);
    expect(started.length).toBeLessThan(12);
  });

  test("the budget stops the run before the call that could pass the cap", async () => {
    const cases = idCases(8);
    const { llm, started } = delayedLlm((id) => ({ ms: id === "c00" ? 5 : 30, step: answer("info") }));
    const report = await runEval(harness().deps(llm), {
      ...opts,
      cases,
      concurrency: 2,
      budget: { ...fixedCost(0.0003), capUsd: 0.001 },
    });
    expect(started).toHaveLength(3);
    expect(report.cost.spentUsd).toBeCloseTo(0.0009, 12);
    expect(report.cost).toMatchObject({ capUsd: 0.001, stoppedByBudget: true });
    expect(report.complete).toBe(false);
    expect(report.stoppedReason).toBe("budget cap reached: resume after the cap allows it");
  });

  test("a resumed run counts the spend of the earlier results against the same cap", async () => {
    const cases = idCases(8);
    const doneUsage = { model: "gemini-3.5-flash-lite", tokensIn: 100, tokensOut: 20, latencyMs: 5 };
    const first = await runEval(harness().deps(fakeLlm([answer("info")]).llm), { ...opts, cases: cases.slice(0, 4) });
    const done = first.cases.map((c) => ({ ...c, usage: doneUsage }));
    const { llm, started } = delayedLlm(() => ({ ms: 10, step: answer("info") }));
    const report = await runEval(harness().deps(llm), {
      ...opts,
      cases,
      done,
      concurrency: 2,
      budget: { ...fixedCost(0.0003), capUsd: 0.0015 },
    });
    expect(started).toEqual(["c04"]);
    expect(report.cost.spentUsd).toBeCloseTo(0.0015, 12);
    expect(report.cost.stoppedByBudget).toBe(true);
    expect(report.cases.map((c) => c.id)).toEqual(["c00", "c01", "c02", "c03", "c04"]);
  });

  test("without a budget the cost is zero and no cap shows", async () => {
    const report = await runEval(harness().deps(fakeLlm([answer("info")]).llm), { ...opts, cases: [makeCase()] });
    expect(report.cost).toEqual({ spentUsd: 0, capUsd: null, stoppedByBudget: false });
  });

  describe("the money cap", () => {
    const budgetOf = (capUsd: number, callCostUsd: () => number | null = () => 0.0003) => ({
      capUsd,
      callCostUsd,
      firstEstimateUsd: 0.0003,
    });

    test("failed attempts, retries included, are charged at the estimate", async () => {
      const { llm, started } = delayedLlm(() => ({ ms: 1, step: soft() }));
      const report = await runEval(harness().deps(llm), {
        ...opts,
        retries: 4,
        cases: idCases(6),
        budget: budgetOf(0.001),
      });
      // 3 attempts reach 0.0009; a 4th would pass the cap, so the case ends and the run stops.
      expect(started).toHaveLength(3);
      expect(report.cost.spentUsd).toBeCloseTo(0.0009, 12);
      expect(report.cost.stoppedByBudget).toBe(true);
      expect(report.cases).toHaveLength(1);
      expect(report.cases[0]?.errorCode).toBe("http_503");
    });

    test("a blocked answer is a call: it is charged", async () => {
      const { llm, started } = delayedLlm(() => ({ ms: 1, step: new LlmBlockedError("m") }));
      const report = await runEval(harness().deps(llm), { ...opts, cases: idCases(8), budget: budgetOf(0.001) });
      expect(started).toHaveLength(3);
      expect(report.cost.spentUsd).toBeCloseTo(0.0009, 12);
      expect(report.cost.stoppedByBudget).toBe(true);
    });

    test("onSpend sees every charge of the run", async () => {
      const { llm } = delayedLlm((id) => ({ ms: 1, step: id === "c00" ? soft() : answer("info") }));
      const seen: number[] = [];
      const report = await runEval(harness().deps(llm), {
        ...opts,
        retries: 1,
        cases: idCases(2),
        budget: { ...budgetOf(1), onSpend: (usd) => seen.push(usd) },
      });
      // one failed attempt, then two answers
      expect(seen).toHaveLength(3);
      expect(seen.reduce((sum, usd) => sum + usd, 0)).toBeCloseTo(report.cost.spentUsd, 12);
    });

    test("an earlier blocked result of a resumed run is charged at the estimate", async () => {
      const first = await runEval(harness().deps(fakeLlm([new LlmBlockedError("m")]).llm), {
        ...opts,
        cases: idCases(1),
      });
      expect(first.cases[0]).toMatchObject({ usage: null, errorCode: null, source: "llm" });
      const { llm } = delayedLlm(() => ({ ms: 1, step: answer("info") }));
      const report = await runEval(harness().deps(llm), {
        ...opts,
        cases: idCases(3),
        done: first.cases,
        budget: budgetOf(1),
      });
      expect(report.cost.spentUsd).toBeCloseTo(0.0003 * 3, 12);
    });

    test("a NaN, infinite or unknown cost is charged at the estimate; a negative cost counts as zero", async () => {
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, null]) {
        const { llm, started } = delayedLlm(() => ({ ms: 1, step: answer("info") }));
        const report = await runEval(harness().deps(llm), {
          ...opts,
          cases: idCases(8),
          budget: budgetOf(0.001, () => bad),
        });
        expect(started).toHaveLength(3);
        expect(report.cost.spentUsd).toBeCloseTo(0.0009, 12);
        expect(report.cost.stoppedByBudget).toBe(true);
      }
      const { llm } = delayedLlm(() => ({ ms: 1, step: answer("info") }));
      const negative = await runEval(harness().deps(llm), {
        ...opts,
        cases: idCases(4),
        budget: budgetOf(0.001, () => -5),
      });
      expect(negative.cost.spentUsd).toBe(0);
      expect(negative.complete).toBe(true);
    });

    test("a zero, NaN or negative estimate, or a NaN cap, is refused", async () => {
      const { llm, started } = delayedLlm(() => ({ ms: 1, step: answer("info") }));
      for (const budget of [
        { ...budgetOf(1), firstEstimateUsd: 0 },
        { ...budgetOf(1), firstEstimateUsd: Number.NaN },
        { ...budgetOf(1), firstEstimateUsd: -1 },
        budgetOf(Number.NaN),
      ]) {
        await expect(runEval(harness().deps(llm), { ...opts, cases: idCases(2), budget })).rejects.toThrow(
          "budget needs a finite cap"
        );
      }
      expect(started).toHaveLength(0);
    });

    test("firstEstimateUsd needs a price today: unknown and inherited names give null", () => {
      const at = new Date("2026-11-14T12:00:00Z");
      expect(firstEstimateUsd("gemini-3.5-flash-lite", at)).toBeGreaterThan(0);
      expect(firstEstimateUsd("gpt-6-luna", at)).toBeGreaterThan(0);
      expect(firstEstimateUsd("no-such-model", at)).toBeNull();
      expect(firstEstimateUsd("toString", at)).toBeNull();
    });
  });
});
