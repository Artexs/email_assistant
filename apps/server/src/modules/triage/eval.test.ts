import { type EvalCase, EVAL_RECEIVED_AT } from "@ea/core";
import { describe, expect, test } from "bun:test";
import type { z } from "zod";

import { LlmBlockedError, LlmConfigError, type LlmClient, LlmSoftError, type LlmUsage } from "../../platform/llm";

import { runEval, toClassifierInput } from "./eval";

const usage: LlmUsage = { model: "gemini-3.5-flash-lite", tokensIn: 100, tokensOut: 20, latencyMs: 50 };

type Step = Record<string, unknown> | Error;

interface Recorded {
  prompt: string;
  system: string;
}

function answer(category: string, confidence = 0.9): Record<string, unknown> {
  return {
    category,
    confidence,
    reason_code: "other",
    reason: "Because.",
    summary: category === "info" ? "Short summary." : null,
    fields: { due_date: null, language: "en" },
  };
}

// Scripted answers by call order; the last step repeats.
function fakeLlm(script: Step[] | ((c: Recorded, n: number) => Step)): { llm: LlmClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const llm: LlmClient = {
    classifierModel: "gemini-3.5-flash-lite",
    async classify<T>(req: { schema: z.ZodType<T>; system: string; prompt: string }) {
      const n = calls.length;
      calls.push({ prompt: req.prompt, system: req.system });
      const step =
        typeof script === "function"
          ? script(calls[n] as Recorded, n)
          : (script[Math.min(n, script.length - 1)] as Step);
      if (step instanceof Error) throw step;
      return { data: step as T, usage };
    },
  };
  return { llm, calls };
}

function makeCase(over: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "c1",
    kind: "synthetic",
    lang: "en",
    from: "someone@sender.test",
    to: ["boss@firma.test"],
    cc: [],
    subject: "Subject",
    body: "Body",
    thread: [],
    senderRules: [],
    expected: { category: "info" },
    ...over,
  };
}

function harness() {
  const waits: number[] = [];
  return {
    waits,
    deps: (llm: LlmClient) => ({
      llm,
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      now: () => new Date("2026-11-05T12:00:00Z"),
    }),
  };
}

const opts = { model: "gemini-3.5-flash-lite", bar: 0.98, minKept: 30, retries: 4 };
const soft = () => new LlmSoftError("http_503", "m");

describe("runEval", () => {
  test("known precision and recall", async () => {
    // expected/predicted: info/info, info/info, info/notification, notification/info, notification/notification
    const cases = [
      makeCase({ id: "a", expected: { category: "info" } }),
      makeCase({ id: "b", expected: { category: "info" } }),
      makeCase({ id: "c", expected: { category: "info" } }),
      makeCase({ id: "d", expected: { category: "notification" } }),
      makeCase({ id: "e", expected: { category: "notification" } }),
    ];
    const { llm } = fakeLlm([
      answer("info"),
      answer("info"),
      answer("notification"),
      answer("info"),
      answer("notification"),
    ]);
    const report = await runEval(harness().deps(llm), { ...opts, cases });
    expect(report.metrics.info.precision).toBeCloseTo(2 / 3);
    expect(report.metrics.info.recall).toBeCloseTo(2 / 3);
    expect(report.metrics.notification.precision).toBe(0.5);
    expect(report.metrics.notification.recall).toBe(0.5);
    expect(report.kind).toBe("cases");
    expect(report.model).toBe("gemini-3.5-flash-lite");
    expect(report.errors).toBe(0);
    expect(report.usage.avgTokensIn).toBe(100);
    expect(report.usage.latencyP50).toBe(50);
  });

  test("a blocklist case makes no LLM call", async () => {
    const { llm, calls } = fakeLlm([answer("info")]);
    const c = makeCase({
      from: "x@bad.test",
      senderRules: [{ pattern: "bad.test", kind: "blocklist" }],
      expected: { category: "spam" },
    });
    const report = await runEval(harness().deps(llm), { ...opts, cases: [c] });
    expect(calls).toHaveLength(0);
    expect(report.cases[0]?.source).toBe("rule");
    expect(report.cases[0]?.finalCategory).toBe("spam");
    expect(report.predictions[0]?.source).toBe("rule");
  });

  test("a whitelisted case with a display name gets no spam in allowed and counts as passed", async () => {
    const { llm, calls } = fakeLlm([answer("needs_reply")]);
    const c = makeCase({
      from: "Anna Kowalska <anna@firma.test>",
      senderRules: [{ pattern: "firma.test", kind: "whitelist" }],
      expected: { category: "needs_reply" },
    });
    const report = await runEval(harness().deps(llm), { ...opts, cases: [c] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.system).not.toContain("spam");
    expect(report.whitelist).toEqual({ passed: 1, total: 1 });
  });

  test("toClassifierInput maps addresses, thread times and the excerpt", () => {
    const c = makeCase({
      from: "Anna Kowalska <anna@firma.test>",
      to: ["Boss <boss@firma.test>"],
      cc: ["cc@firma.test"],
      thread: [
        { from: "Anna Kowalska <anna@firma.test>", subject: "Re: a", body: "x".repeat(600) },
        { from: "boss@firma.test", subject: "Re: b", body: "short" },
      ],
    });
    const input = toClassifierInput(c);
    expect(input.from).toBe("anna@firma.test");
    expect(input.to).toEqual(["boss@firma.test"]);
    expect(input.cc).toEqual(["cc@firma.test"]);
    expect(input.receivedAt).toEqual(EVAL_RECEIVED_AT);
    expect(input.bodyText).toBe("Body");
    expect(input.thread[0]?.from).toBe("anna@firma.test");
    expect(input.thread[0]?.receivedAt.getTime()).toBe(EVAL_RECEIVED_AT.getTime() - 2 * 3_600_000);
    expect(input.thread[1]?.receivedAt.getTime()).toBe(EVAL_RECEIVED_AT.getTime() - 3_600_000);
    expect(input.thread[0]?.bodyExcerpt).toHaveLength(500);
    expect(input.thread[1]?.bodyExcerpt).toBe("short");
  });

  test("a blocked answer is unsure, not an error", async () => {
    const { llm, calls } = fakeLlm([new LlmBlockedError("m")]);
    const c = makeCase({ id: "inj", kind: "injection", expected: { category: "spam" } });
    const report = await runEval(harness().deps(llm), { ...opts, cases: [c] });
    expect(calls).toHaveLength(1);
    expect(report.cases[0]).toMatchObject({
      blocked: true,
      finalCategory: "unsure",
      modelCategory: "unsure",
      confidence: 0,
      errorCode: null,
    });
    expect(report.errors).toBe(0);
    expect(report.blocked).toEqual({ total: 1, ids: ["inj"] });
    expect(report.predictions).toEqual([
      { expected: "spam", predicted: "unsure", modelCategory: "unsure", confidence: 0, source: "llm" },
    ]);
    expect(report.injection).toEqual({ passed: 1, total: 1, failedIds: [] });
  });

  test("a soft error twice then success keeps the result", async () => {
    const h = harness();
    const { llm } = fakeLlm([soft(), soft(), answer("info")]);
    const report = await runEval(h.deps(llm), { ...opts, cases: [makeCase()] });
    expect(report.errors).toBe(0);
    expect(report.cases[0]?.finalCategory).toBe("info");
    expect(h.waits).toEqual([10_000, 20_000]);
  });

  test("5 soft errors with retries 4 end as an error", async () => {
    const h = harness();
    const { llm, calls } = fakeLlm([soft()]);
    const report = await runEval(h.deps(llm), { ...opts, cases: [makeCase()] });
    expect(calls).toHaveLength(5);
    expect(h.waits).toEqual([10_000, 20_000, 40_000, 60_000]);
    expect(report.errors).toBe(1);
    expect(report.errorCodes).toEqual({ http_503: 1 });
    expect(report.cases[0]?.errorCode).toBe("http_503");
    expect(report.predictions).toHaveLength(0);
  });

  test("2 soft errors with retries 1 end as an error after one wait", async () => {
    const h = harness();
    const { llm } = fakeLlm([soft()]);
    const report = await runEval(h.deps(llm), { ...opts, retries: 1, cases: [makeCase()] });
    expect(h.waits).toEqual([10_000]);
    expect(report.errors).toBe(1);
  });

  test("a config error rejects and stops the run", async () => {
    const { llm, calls } = fakeLlm([new LlmConfigError("http_401", "m")]);
    const cases = [makeCase({ id: "a" }), makeCase({ id: "b" })];
    await expect(runEval(harness().deps(llm), { ...opts, cases })).rejects.toBeInstanceOf(LlmConfigError);
    expect(calls).toHaveLength(1);
  });

  test("another hard error marks the case at once", async () => {
    const { llm, calls } = fakeLlm([new Error("boom")]);
    const report = await runEval(harness().deps(llm), { ...opts, cases: [makeCase()] });
    expect(calls).toHaveLength(1);
    expect(report.cases[0]?.errorCode).toBe("unknown");
  });

  test("an injection case where the model says urgent passes the structural check", async () => {
    const { llm } = fakeLlm([answer("urgent")]);
    const c = makeCase({ id: "inj", kind: "injection", expected: { category: "spam" } });
    const report = await runEval(harness().deps(llm), { ...opts, cases: [c] });
    expect(report.cases[0]?.plannedTypes).toEqual(["flag"]);
    expect(report.cases[0]?.injectionPassed).toBe(true);
    expect(report.injection).toEqual({ passed: 1, total: 1, failedIds: [] });
  });

  test("the report has a go/no-go entry for each category with the given minKept", async () => {
    const { llm } = fakeLlm([answer("info")]);
    const report = await runEval(harness().deps(llm), { ...opts, minKept: 1, cases: [makeCase()] });
    expect(Object.keys(report.goNoGo).sort()).toEqual(["info", "needs_reply", "notification", "spam", "urgent"]);
    expect(report.minKept).toBe(1);
    expect(report.goNoGo.info.decision).toBe("go");
    expect(report.goNoGo.spam.decision).toBe("no-go: too few");
  });
});
