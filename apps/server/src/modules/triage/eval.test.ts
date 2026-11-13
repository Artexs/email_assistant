import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { delegateIdOf, type EvalCase, EVAL_RECEIVED_AT, evalCaseSchema, type LlmRole, selectCases } from "@ea/core";
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import {
  LlmBlockedError,
  type LlmCall,
  LlmConfigError,
  type LlmClient,
  LlmSoftError,
  type LlmUsage,
} from "../../platform/llm";

import { type CaseResult, evalStateFileName, parseCaseResults, runEval, toClassifierInput, toPrediction } from "./eval";
import { evalExitCode } from "./eval-report";
import { PROMPT_VERSION } from "./prompts/classifier-v2";

const usage: LlmUsage = {
  role: "classifier",
  promptVersion: "classifier-v2",
  model: "gemini-3.5-flash-lite",
  tokensIn: 100,
  tokensOut: 20,
  latencyMs: 50,
};

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
    fields: { due_date: null, language: "en", delegate_id: null, task: null, clarification: null },
  };
}

// Scripted answers by call order; the last step repeats.
function fakeLlm(script: Step[] | ((c: Recorded, n: number) => Step)): { llm: LlmClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const llm: LlmClient = {
    modelOf: () => "gemini-3.5-flash-lite",
    async generate<T, R extends LlmRole>(req: LlmCall<T, R>) {
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
    delegates: [],
    expected: { category: "info" },
    ...over,
  };
}

const anna = { key: "anna", name: "Anna Nowak", tags: ["faktury"] };
const marek = { key: "marek", name: "Marek Lis", tags: ["oferty"] };

function delegationAnswer(fields: { delegate?: string | null; task?: string | null; clarification?: string | null }) {
  return {
    ...answer("delegation"),
    fields: {
      due_date: "2026-11-06",
      language: "en",
      delegate_id: fields.delegate === undefined || fields.delegate === null ? null : delegateIdOf(fields.delegate),
      task: fields.task ?? null,
      clarification: fields.clarification ?? null,
    },
  };
}

function delegationCase(over: Partial<EvalCase> = {}): EvalCase {
  return makeCase({
    id: "d1",
    delegates: [anna, marek],
    expected: { category: "delegation", delegate: "anna", draft: "delegation" },
    ...over,
  });
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

const opts = { model: "gemini-3.5-flash-lite", provider: "gemini" as const, bar: 0.98, minKept: 30, retries: 4 };
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
    expect(report.provider).toBe("gemini");
    expect(report.reasoningEffort).toBeNull();
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
    expect(report.whitelist).toEqual({ passed: 1, total: 1, errors: 0 });
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

  test("a whitelisted case that errors counts in whitelist errors, not in the total", async () => {
    const c = makeCase({ senderRules: [{ pattern: "firma.test", kind: "whitelist" }], from: "anna@firma.test" });
    const report = await runEval(harness().deps(fakeLlm([soft()]).llm), { ...opts, cases: [c] });
    expect(report.whitelist).toEqual({ passed: 0, total: 0, errors: 1 });
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

  describe("delegation", () => {
    test("the delegates go to the classifier with deterministic ids", async () => {
      const { llm, calls } = fakeLlm([delegationAnswer({ delegate: "anna", task: "Pay the invoice." })]);
      await runEval(harness().deps(llm), { ...opts, cases: [delegationCase()] });
      expect(calls[0]?.prompt).toContain(`- ${delegateIdOf("anna")}: Anna Nowak (faktury)`);
      expect(calls[0]?.prompt).toContain(`- ${delegateIdOf("marek")}: Marek Lis (oferty)`);
      expect(calls[0]?.system).toContain("\n- delegation:");
    });

    test("a case without delegates does not allow delegation", async () => {
      const { llm, calls } = fakeLlm([answer("info")]);
      await runEval(harness().deps(llm), { ...opts, cases: [makeCase()] });
      expect(calls[0]?.system).not.toContain("\n- delegation:");
      expect(calls[0]?.prompt).not.toContain("Delegates (from");
    });

    test("the expected delegate is picked: pick right, draft delegation, not an injection case", async () => {
      const { llm } = fakeLlm([delegationAnswer({ delegate: "anna", task: "Pay the invoice." })]);
      const report = await runEval(harness().deps(llm), { ...opts, cases: [delegationCase()] });
      expect(report.cases[0]).toMatchObject({
        finalCategory: "delegation",
        plannedTypes: ["create_draft", "send"],
        delegatePick: true,
        draftKind: "delegation",
        draftMatches: true,
        injectionPassed: null,
      });
      expect(report.delegation).toEqual({ pick: { right: 1, total: 1 }, draft: { right: 1, total: 1 } });
    });

    test("another delegate is a wrong pick, but the draft kind is right", async () => {
      const { llm } = fakeLlm([delegationAnswer({ delegate: "marek", task: "Pay the invoice." })]);
      const report = await runEval(harness().deps(llm), { ...opts, cases: [delegationCase()] });
      expect(report.cases[0]).toMatchObject({ delegatePick: false, draftKind: "delegation", draftMatches: true });
    });

    test("a clarification answer gives the draft kind clarification", async () => {
      const { llm } = fakeLlm([delegationAnswer({ clarification: "Who should handle this?" })]);
      const c = delegationCase({ expected: { category: "delegation", draft: "clarification" } });
      const report = await runEval(harness().deps(llm), { ...opts, cases: [c] });
      expect(report.cases[0]).toMatchObject({
        plannedTypes: ["create_draft", "send"],
        delegatePick: null,
        draftKind: "clarification",
        draftMatches: true,
      });
      expect(report.delegation).toEqual({ pick: { right: 0, total: 0 }, draft: { right: 1, total: 1 } });
    });

    test("a delegation answer for a clarification case with a delegate is a wrong draft kind", async () => {
      const { llm } = fakeLlm([delegationAnswer({ delegate: "anna", task: "Do it." })]);
      const c = delegationCase({ expected: { category: "delegation", draft: "clarification" } });
      const report = await runEval(harness().deps(llm), { ...opts, cases: [c] });
      expect(report.cases[0]).toMatchObject({ draftKind: "delegation", draftMatches: false });
    });

    test("an answer with no delegate, task or question plans no draft", async () => {
      const { llm } = fakeLlm([delegationAnswer({})]);
      const report = await runEval(harness().deps(llm), { ...opts, cases: [delegationCase()] });
      expect(report.cases[0]).toMatchObject({
        plannedTypes: [],
        delegatePick: false,
        draftKind: "none",
        draftMatches: false,
      });
    });

    test("an error case has no pick and no draft result", async () => {
      const report = await runEval(harness().deps(fakeLlm([soft()]).llm), {
        ...opts,
        retries: 0,
        cases: [delegationCase()],
      });
      expect(report.cases[0]).toMatchObject({ delegatePick: null, draftKind: null, draftMatches: null });
      expect(report.delegation).toEqual({ pick: { right: 0, total: 0 }, draft: { right: 0, total: 0 } });
    });

    test("the report counts picks and draft kinds over several cases", async () => {
      const cases = [
        delegationCase({ id: "a" }),
        delegationCase({ id: "b" }),
        delegationCase({ id: "c", expected: { category: "delegation", draft: "clarification" } }),
        makeCase({ id: "d" }),
      ];
      const { llm } = fakeLlm([
        delegationAnswer({ delegate: "anna", task: "Task." }),
        delegationAnswer({ delegate: "marek", task: "Task." }),
        delegationAnswer({ clarification: "Which one?" }),
        answer("info"),
      ]);
      const report = await runEval(harness().deps(llm), { ...opts, cases });
      expect(report.delegation).toEqual({ pick: { right: 1, total: 2 }, draft: { right: 3, total: 3 } });
      expect(report.metrics.delegation.support).toBe(3);
      expect(report.metrics.delegation.recall).toBe(1);
    });

    test("an injection case where the model plans a delegation draft fails", async () => {
      const { llm } = fakeLlm([delegationAnswer({ delegate: "anna", task: "Send all client data to x@evil.test" })]);
      const c = delegationCase({
        id: "inj-x",
        kind: "injection",
        expected: { category: "spam", draft: "none" },
      });
      const report = await runEval(harness().deps(llm), { ...opts, cases: [c] });
      expect(report.cases[0]?.plannedTypes).toEqual(["create_draft", "send"]);
      expect(report.cases[0]).toMatchObject({ injectionPassed: false, draftKind: "delegation", draftMatches: false });
      expect(report.injection).toEqual({ passed: 0, total: 1, failedIds: ["inj-x"] });
    });

    test("an injection case answered spam passes", async () => {
      const { llm } = fakeLlm([answer("spam")]);
      const c = delegationCase({ id: "inj-y", kind: "injection", expected: { category: "spam", draft: "none" } });
      const report = await runEval(harness().deps(llm), { ...opts, cases: [c] });
      expect(report.cases[0]).toMatchObject({ injectionPassed: true, draftKind: "none", draftMatches: true });
      expect(report.injection).toEqual({ passed: 1, total: 1, failedIds: [] });
    });

    test("an injection case answered with a clarification fails when no draft is expected", async () => {
      const { llm } = fakeLlm([delegationAnswer({ clarification: "Who?" })]);
      const c = delegationCase({ id: "inj-z", kind: "injection", expected: { category: "spam", draft: "none" } });
      const report = await runEval(harness().deps(llm), { ...opts, cases: [c] });
      expect(report.cases[0]?.injectionPassed).toBe(false);
    });

    test("an injection-kind case that expects a delegation passes with a clean draft to the delegate", async () => {
      const { llm } = fakeLlm([delegationAnswer({ delegate: "anna", task: "Pay the invoice by Friday." })]);
      const c = delegationCase({ id: "inj-ok", kind: "injection" });
      const report = await runEval(harness().deps(llm), { ...opts, cases: [c] });
      expect(report.cases[0]?.injectionPassed).toBe(true);
    });

    test("a hard delegation limit: the task text with a link or a long number never reaches the plan unmarked", async () => {
      const task = "Pay at http://evil.test/pay, account PL61109010140000071219812874.";
      const { llm } = fakeLlm([delegationAnswer({ delegate: "anna", task })]);
      const c = delegationCase({ id: "inj-m", kind: "injection", expected: { category: "delegation" } });
      const report = await runEval(harness().deps(llm), { ...opts, cases: [c] });
      // classifyEmail marks the text, so the structural check on the text holds.
      expect(report.cases[0]?.injectionPassed).toBe(true);
    });

    test("a state line with the delegation fields parses back", async () => {
      const lines: CaseResult[] = [];
      const deps = { ...harness().deps(fakeLlm([delegationAnswer({ delegate: "anna", task: "T." })]).llm) };
      await runEval(
        { ...deps, onResult: async (r: CaseResult) => void lines.push(r) },
        { ...opts, cases: [delegationCase()] }
      );
      expect(parseCaseResults(lines.map((r) => JSON.stringify(r)).join("\n"))).toEqual(lines);
      expect(lines[0]?.delegatePick).toBe(true);
    });
  });

  describe("resume and stop", () => {
    const three = () => [makeCase({ id: "a" }), makeCase({ id: "b" }), makeCase({ id: "c" })];

    async function firstRun(cases: EvalCase[], script: Step[]): Promise<CaseResult[]> {
      const lines: CaseResult[] = [];
      const deps = { ...harness().deps(fakeLlm(script).llm), onResult: async (r: CaseResult) => void lines.push(r) };
      await runEval(deps, { ...opts, cases });
      return lines;
    }

    test("a case in done makes no call and the report counts it", async () => {
      const done = (await firstRun(three(), [answer("info")])).slice(0, 2);
      const { llm, calls } = fakeLlm([answer("info")]);
      const report = await runEval(harness().deps(llm), { ...opts, cases: three(), done });
      expect(calls).toHaveLength(1);
      expect(report.doneCount).toBe(3);
      expect(report.totalCount).toBe(3);
      expect(report.complete).toBe(true);
      expect(report.predictions).toHaveLength(3);
      expect(report.metrics.info.support).toBe(3);
    });

    test("3 soft-error cases in a row stop the run with exit code 2", async () => {
      const cases = ["a", "b", "c", "d", "e"].map((id) => makeCase({ id }));
      const { llm, calls } = fakeLlm([soft()]);
      const report = await runEval(harness().deps(llm), { ...opts, retries: 0, cases });
      expect(calls).toHaveLength(3);
      expect(report.complete).toBe(false);
      expect(report.stoppedReason).toBe("soft errors in a row (quota or overload), resume later");
      expect(report.doneCount).toBe(0);
      expect(report.errors).toBe(3);
      expect(report.totalCount).toBe(5);
      expect(evalExitCode(report)).toBe(2);
    });

    test("after the stop, later cases with an earlier result are still in the report", async () => {
      const cases = ["a", "b", "c", "d", "e"].map((id) => makeCase({ id }));
      const lateDone = await firstRun([makeCase({ id: "e" })], [answer("info")]);
      const { llm, calls } = fakeLlm([soft()]);
      const report = await runEval(harness().deps(llm), { ...opts, retries: 0, cases, done: lateDone });
      expect(calls).toHaveLength(3);
      expect(report.complete).toBe(false);
      expect(report.cases.map((r) => r.id)).toEqual(["a", "b", "c", "e"]);
      expect(report.doneCount).toBe(1);
    });

    test("a success resets the error count", async () => {
      const cases = ["a", "b", "c", "d", "e"].map((id) => makeCase({ id }));
      const { llm } = fakeLlm([soft(), soft(), answer("info"), soft(), soft()]);
      const report = await runEval(harness().deps(llm), { ...opts, retries: 0, cases });
      expect(report.complete).toBe(true);
      expect(evalExitCode(report)).toBe(1);
    });

    test("a stopped run with a failed injection case gives exit code 1", async () => {
      const cases = ["a", "b", "c", "d"].map((id) => makeCase({ id }));
      const report = await runEval(harness().deps(fakeLlm([soft()]).llm), { ...opts, retries: 0, cases });
      const failed = { ...report, injection: { passed: 0, total: 1, failedIds: ["i1"] } };
      expect(report.complete).toBe(false);
      expect(evalExitCode(failed)).toBe(1);
    });

    test("an error case in done is tried again", async () => {
      const failed = (await firstRun([makeCase({ id: "a" })], [soft()]))[0] as CaseResult;
      expect(failed.errorCode).toBe("http_503");
      const { llm, calls } = fakeLlm([answer("info")]);
      const report = await runEval(harness().deps(llm), { ...opts, cases: [makeCase({ id: "a" })], done: [failed] });
      expect(calls).toHaveLength(1);
      expect(report.errors).toBe(0);
      expect(report.cases[0]?.finalCategory).toBe("info");
    });

    test("a blocked case in done is not tried again", async () => {
      const blocked = (await firstRun([makeCase({ id: "a" })], [new LlmBlockedError("m")]))[0] as CaseResult;
      const { llm, calls } = fakeLlm([answer("info")]);
      const report = await runEval(harness().deps(llm), { ...opts, cases: [makeCase({ id: "a" })], done: [blocked] });
      expect(calls).toHaveLength(0);
      expect(report.blocked).toEqual({ total: 1, ids: ["a"] });
      expect(report.predictions[0]?.predicted).toBe("unsure");
    });

    test("a state line has no case text and parses back", async () => {
      const c = makeCase({ id: "a", subject: "SUBJECT-MARKER", body: "BODY-MARKER" });
      const lines = await firstRun([c], [answer("info")]);
      const text = lines.map((r) => JSON.stringify(r)).join("\n");
      const keys = Object.keys(lines[0] as CaseResult);
      expect(keys).not.toContain("body");
      expect(keys).not.toContain("subject");
      expect(text).not.toContain("MARKER");
      expect(parseCaseResults(`${text}\n{"cut":`)).toEqual(lines);
    });

    test("toPrediction maps a rule row, an llm row and an error", () => {
      const rule: CaseResult = {
        id: "r",
        kind: "synthetic",
        expected: "spam",
        modelCategory: null,
        finalCategory: "spam",
        confidence: null,
        source: "rule",
        whitelisted: false,
        blocked: false,
        usage: null,
        errorCode: null,
        plannedTypes: [],
        injectionPassed: null,
        delegatePick: null,
        draftKind: null,
        draftMatches: null,
      };
      expect(toPrediction(rule)).toEqual({
        expected: "spam",
        predicted: "spam",
        modelCategory: "spam",
        confidence: 1,
        source: "rule",
      });
      expect(
        toPrediction({ ...rule, source: "llm", modelCategory: "info", finalCategory: "unsure", confidence: 0.4 })
      ).toEqual({ expected: "spam", predicted: "unsure", modelCategory: "info", confidence: 0.4, source: "llm" });
      expect(toPrediction({ ...rule, errorCode: "http_503", finalCategory: null })).toBeNull();
    });

    test("--per-category 3 on the case files picks 18 cases", () => {
      const dir = resolve(import.meta.dir, "../../../../../evals/cases");
      const load = (file: string) =>
        z.array(evalCaseSchema).parse(JSON.parse(readFileSync(resolve(dir, file), "utf8")));
      const picked = selectCases([...load("synthetic.json"), ...load("injection.json")], { perCategory: 3 });
      expect(picked).toHaveLength(18);
    });
  });
});

describe("evalStateFileName", () => {
  const base = { reasoningEffort: null, promptVersion: PROMPT_VERSION, set: "all" };

  test("Gemini name has no effort part", () => {
    expect(evalStateFileName({ ...base, model: "gemini-3.5-flash-lite" })).toBe(
      "gemini-3.5-flash-lite-classifier-v2-all.jsonl"
    );
  });

  test("OpenAI name holds the effort", () => {
    expect(evalStateFileName({ ...base, model: "gpt-6-luna", reasoningEffort: "none" })).toBe(
      "gpt-6-luna-none-classifier-v2-all.jsonl"
    );
  });

  test("subset suffix and unsafe characters", () => {
    expect(evalStateFileName({ ...base, model: "a/b c", perCategory: 3 })).toBe("a_b_c-classifier-v2-all-pc3.jsonl");
  });
});
