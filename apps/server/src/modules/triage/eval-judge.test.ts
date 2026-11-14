import { delegateIdOf, type EvalCase, type LlmRole } from "@ea/core";
import { describe, expect, test } from "bun:test";

import { type LlmCall, type LlmClient, LlmConfigError, LlmSoftError, type LlmUsage } from "../../platform/llm";

import { type CaseResult, delegateAddress, parseCaseResults, runEval } from "./eval";
import { judgeReusable, summarizeJudge } from "./eval-judge";
import { evalExitCode } from "./eval-report";

type Step = Record<string, unknown> | Error;

const classifierUsage: LlmUsage = {
  role: "classifier",
  promptVersion: "classifier-v2",
  model: "gemini-3.5-flash-lite",
  tokensIn: 100,
  tokensOut: 20,
  latencyMs: 50,
};

const allTwos = {
  facts_kept: 2,
  task_clear: 2,
  tone_fits: 2,
  no_invented_promise: true,
  injection_ignored: true,
};

const DRAFT_TASK = "Pay the invoice DRAFT-TASK-MARKER.";

function delegationAnswer(task: string | null = DRAFT_TASK, delegate = "anna") {
  return {
    category: "delegation",
    confidence: 0.9,
    reason_code: "other",
    reason: "Because.",
    summary: null,
    fields: {
      due_date: "2026-11-06",
      language: "en",
      delegate_id: delegateIdOf(delegate),
      task,
      clarification: null,
    },
  };
}

const infoAnswer = {
  category: "info",
  confidence: 0.9,
  reason_code: "other",
  reason: "Because.",
  summary: "Short summary.",
  fields: { due_date: null, language: "en", delegate_id: null, task: null, clarification: null },
};

// One fake client for both roles: a script per role, the last step repeats.
function routedLlm(scripts: { classifier: Step[]; judge: Step[] }) {
  const calls: { role: LlmRole; model?: string }[] = [];
  const counts = { classifier: 0, judge: 0 };
  const llm: LlmClient = {
    modelOf: () => "fake",
    async generate<T, R extends LlmRole>(req: LlmCall<T, R>) {
      const role = req.role as "classifier" | "judge";
      const script = scripts[role];
      const step = script[Math.min(counts[role], script.length - 1)] as Step;
      counts[role] += 1;
      calls.push({ role: req.role, model: req.model });
      if (step instanceof Error) throw step;
      const usage: LlmUsage =
        role === "judge"
          ? { ...classifierUsage, role: "judge", promptVersion: "judge-v1", model: "judge-model", tokensIn: 300 }
          : classifierUsage;
      return { data: step as T, usage };
    },
  };
  return { llm, calls, counts };
}

function delegationCase(id: string, over: Partial<EvalCase> = {}): EvalCase {
  return {
    id,
    kind: "synthetic",
    lang: "en",
    from: "someone@sender.test",
    to: ["boss@firma.test"],
    cc: [],
    subject: "Invoice",
    body: "Please get the invoice paid.",
    thread: [],
    senderRules: [],
    delegates: [{ key: "anna", name: "Anna Nowak", tags: ["faktury"] }],
    expected: { category: "delegation", delegate: "anna", draft: "delegation" },
    ...over,
  };
}

const opts = { model: "gemini-3.5-flash-lite", provider: "gemini" as const, bar: 0.98, minKept: 30, retries: 0 };
const judgeSetup = (llm: LlmClient) => ({ llm, model: "judge-model", addressOf: delegateAddress });
const deps = (llm: LlmClient) => ({
  llm,
  sleep: async () => undefined,
  now: () => new Date("2026-11-05T12:00:00Z"),
});
const soft = () => new LlmSoftError("http_503", "m");
const ids = (n: number) => Array.from({ length: n }, (_, i) => delegationCase(`d${i}`));

describe("eval --judge", () => {
  test("a planned delegation draft is judged; the state line holds no draft text", async () => {
    const { llm, counts, calls } = routedLlm({ classifier: [delegationAnswer()], judge: [allTwos] });
    const lines: CaseResult[] = [];
    const report = await runEval(
      { ...deps(llm), onResult: async (r) => void lines.push(r) },
      { ...opts, cases: [delegationCase("d1")], judge: judgeSetup(llm) }
    );
    expect(report.cases[0]?.judge).toEqual({
      kind: "delegation",
      codeFailed: [],
      scores: { facts_kept: 2, task_clear: 2, tone_fits: 2 },
      checks: { no_invented_promise: true, injection_ignored: true },
      passed: true,
    });
    expect(counts).toEqual({ classifier: 1, judge: 1 });
    expect(calls.find((c) => c.role === "judge")?.model).toBe("judge-model");
    expect(report.judge).toMatchObject({ judged: 1, passed: 1, errors: 0, codePassed: 1 });
    const text = lines.map((r) => JSON.stringify(r)).join("\n");
    expect(text).not.toContain("DRAFT-TASK-MARKER");
    expect(parseCaseResults(text)).toEqual(lines);
  });

  test("a failed code check fails the draft: a draft to a delegate that the case does not expect", async () => {
    const { llm } = routedLlm({ classifier: [delegationAnswer(DRAFT_TASK, "marek")], judge: [allTwos] });
    const c = delegationCase("d1", {
      delegates: [
        { key: "anna", name: "Anna Nowak", tags: [] },
        { key: "marek", name: "Marek Lis", tags: [] },
      ],
    });
    const report = await runEval(deps(llm), { ...opts, cases: [c], judge: judgeSetup(llm) });
    expect(report.cases[0]?.judge).toMatchObject({ codeFailed: ["recipient"], passed: false });
  });

  test("a case with no draft has no judge result and makes no judge call", async () => {
    const { llm, counts } = routedLlm({ classifier: [infoAnswer], judge: [allTwos] });
    const c = delegationCase("i1", { expected: { category: "info" } });
    const report = await runEval(deps(llm), { ...opts, cases: [c], judge: judgeSetup(llm) });
    expect(report.cases[0]).toMatchObject({ judge: null, judgeUsage: null });
    expect(counts.judge).toBe(0);
    expect(report.judge).toBeNull();
  });

  test("without a judge setup no judge call happens", async () => {
    const { llm, counts } = routedLlm({ classifier: [delegationAnswer()], judge: [allTwos] });
    const report = await runEval(deps(llm), { ...opts, cases: [delegationCase("d1")] });
    expect(counts.judge).toBe(0);
    expect(report.cases[0]?.judge).toBeNull();
  });

  test("a judge soft error with no retries is an error code; the classifier result stays", async () => {
    const { llm } = routedLlm({ classifier: [delegationAnswer()], judge: [soft()] });
    const report = await runEval(deps(llm), { ...opts, cases: [delegationCase("d1")], judge: judgeSetup(llm) });
    expect(report.cases[0]).toMatchObject({
      finalCategory: "delegation",
      errorCode: null,
      draftKind: "delegation",
      judge: { kind: "delegation", errorCode: "http_503" },
      judgeUsage: null,
    });
    expect(report.judge).toMatchObject({ judged: 1, errors: 1, passed: 0, scored: 0 });
  });

  test("a judge config error rejects the run", async () => {
    const { llm } = routedLlm({ classifier: [delegationAnswer()], judge: [new LlmConfigError("missing_key", "m")] });
    await expect(
      runEval(deps(llm), { ...opts, cases: [delegationCase("d1")], judge: judgeSetup(llm) })
    ).rejects.toBeInstanceOf(LlmConfigError);
  });

  test("an old state line without judge fields parses with judge null", () => {
    const line = JSON.stringify({
      id: "old",
      kind: "synthetic",
      expected: "info",
      modelCategory: "info",
      finalCategory: "info",
      confidence: 0.9,
      source: "llm",
      whitelisted: false,
      blocked: false,
      usage: null,
      errorCode: null,
      plannedTypes: [],
      injectionPassed: null,
    });
    expect(parseCaseResults(line)[0]).toMatchObject({ judge: null, judgeUsage: null });
  });

  test("3 judge errors in a row stop the run; a resume re-runs exactly those 3 cases", async () => {
    const failing = routedLlm({ classifier: [delegationAnswer()], judge: [soft()] });
    const lines: CaseResult[] = [];
    const first = await runEval(
      { ...deps(failing.llm), onResult: async (r) => void lines.push(r) },
      { ...opts, cases: ids(4), judge: judgeSetup(failing.llm) }
    );
    expect(first.complete).toBe(false);
    expect(first.cases).toHaveLength(3);
    expect(failing.counts.classifier).toBe(3);
    expect(evalExitCode(first)).toBe(2);

    const working = routedLlm({ classifier: [delegationAnswer()], judge: [allTwos] });
    const second = await runEval(deps(working.llm), {
      ...opts,
      cases: ids(3),
      done: lines,
      judge: judgeSetup(working.llm),
    });
    expect(working.counts).toEqual({ classifier: 3, judge: 3 });
    expect(second.complete).toBe(true);
    expect(second.judge).toMatchObject({ judged: 3, passed: 3, errors: 0 });
  });

  test("a resume reuses a scored result and a no-draft result; a judge-less or errored draft result runs again", async () => {
    const seed = routedLlm({ classifier: [delegationAnswer()], judge: [allTwos] });
    const first: CaseResult[] = [];
    await runEval(
      { ...deps(seed.llm), onResult: async (r) => void first.push(r) },
      { ...opts, cases: ids(1), judge: judgeSetup(seed.llm) }
    );
    const scored = first[0] as CaseResult;
    const noJudge = { ...scored, id: "d1", judge: null, judgeUsage: null };
    const errored = { ...scored, id: "d2", judge: { kind: "delegation" as const, errorCode: "http_503" } };
    const noDraft = { ...scored, id: "d3", draftKind: "none" as const, judge: null };
    expect([scored, noJudge, errored, noDraft].map(judgeReusable)).toEqual([true, false, false, true]);

    const { llm, counts } = routedLlm({ classifier: [delegationAnswer()], judge: [allTwos] });
    const report = await runEval(deps(llm), {
      ...opts,
      cases: ids(4),
      done: [scored, noJudge, errored, noDraft],
      judge: judgeSetup(llm),
    });
    // d0 and d3 are reused; d1 and d2 run again (classifier and judge).
    expect(counts).toEqual({ classifier: 2, judge: 2 });
    expect(report.cases).toHaveLength(4);
  });

  test("the judge call counts in the budget", async () => {
    const { llm } = routedLlm({ classifier: [delegationAnswer()], judge: [allTwos] });
    const report = await runEval(deps(llm), {
      ...opts,
      cases: [delegationCase("d1")],
      judge: judgeSetup(llm),
      budget: { capUsd: 1, callCostUsd: () => 0.0003, firstEstimateUsd: 0.0003 },
    });
    expect(report.cost.spentUsd).toBeCloseTo(0.0006, 12);
  });
});

describe("summarizeJudge", () => {
  test("counts passes, errors, code failures and score means", () => {
    const ok = (passed: boolean, codeFailed: ("recipient" | "planted")[], task: number) => ({
      judge: {
        kind: "delegation" as const,
        codeFailed,
        scores: { task_clear: task },
        checks: { injection_ignored: true },
        passed,
      },
    });
    const summary = summarizeJudge([
      ok(true, [], 2),
      ok(true, [], 1),
      ok(false, ["recipient"], 0),
      { judge: { kind: "delegation" as const, errorCode: "x" } },
      { judge: null },
    ]);
    expect(summary).toEqual({
      judged: 4,
      errors: 1,
      codePassed: 2,
      codeFailedBy: { recipient: 1 },
      scoreMeans: { task_clear: 1 },
      passed: 2,
      scored: 3,
    });
  });
});
