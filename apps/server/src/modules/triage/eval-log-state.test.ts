import { type LlmEndpointKind } from "@ea/core";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { evalStateFileName, runEval } from "./eval";
import { BUDGET_STOP_REASON } from "./eval-pool";
import { answer, fakeLlm, makeCase, harness, opts, soft, delayedLlm, idCases, fixedCost } from "./eval.test-helper";
import { type ClassifierV3Part, promptLabel } from "./prompts";
import { PROMPT_VERSION } from "./prompts/classifier-v2";

describe("eval log lines", () => {
  let lines: string[] = [];
  let spies: ReturnType<typeof spyOn>[] = [];

  beforeEach(() => {
    lines = [];
    spies = (["log", "error"] as const).map((name) =>
      spyOn(console, name).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      })
    );
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
  });

  test("a soft error then success writes eval_case_retry and eval_case_done", async () => {
    const { llm } = fakeLlm([soft(), soft(), answer("info")]);
    await runEval(harness().deps(llm), { ...opts, cases: [makeCase({ id: "inv-001" })] });
    expect(lines).toEqual([
      "[eval] eval_case_retry case_id=inv-001 attempts=1 wait_ms=10000",
      "[eval] eval_case_retry case_id=inv-001 attempts=2 wait_ms=20000",
      "[eval] eval_case_done case_id=inv-001 category=info",
    ]);
  });

  test("a case that ends in an error writes eval_case_failed and eval_case_done with the code", async () => {
    const { llm } = fakeLlm([soft()]);
    await runEval(harness().deps(llm), { ...opts, retries: 0, cases: [makeCase({ id: "inv-002" })] });
    expect(lines).toEqual([
      "[eval] eval_case_failed case_id=inv-002 code=http_503",
      "[eval] eval_case_done case_id=inv-002 error_code=http_503",
    ]);
  });

  test("a run stopped by soft errors writes eval_stopped reason=error_streak, not the reason text", async () => {
    const cases = ["a", "b", "c", "d", "e"].map((id) => makeCase({ id }));
    const { llm } = fakeLlm([soft()]);
    const report = await runEval(harness().deps(llm), { ...opts, retries: 0, cases });
    expect(report.stoppedReason).toContain("soft errors in a row");
    expect(lines.filter((line) => line.includes("eval_stopped"))).toEqual(["[eval] eval_stopped reason=error_streak"]);
    expect(lines.join("\n")).not.toContain("soft errors in a row");
  });

  test("a run stopped by the budget cap writes eval_stopped reason=budget_cap, not the reason text", async () => {
    const { llm } = delayedLlm((id) => ({ ms: id === "c00" ? 5 : 30, step: answer("info") }));
    const report = await runEval(harness().deps(llm), {
      ...opts,
      cases: idCases(8),
      concurrency: 2,
      budget: { ...fixedCost(0.0003), capUsd: 0.001 },
    });
    expect(report.stoppedReason).toBe(BUDGET_STOP_REASON);
    expect(lines.filter((line) => line.includes("eval_stopped"))).toEqual(["[eval] eval_stopped reason=budget_cap"]);
    expect(lines.join("\n")).not.toContain(BUDGET_STOP_REASON);
    expect(lines.join("\n")).not.toContain("budget cap reached");
  });
});

describe("evalStateFileName", () => {
  const base = {
    reasoningEffort: null,
    promptVersion: PROMPT_VERSION,
    set: "all",
    endpoint: "standard" as LlmEndpointKind,
    provider: "openai" as const,
  };

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

  test("a prompt label with parts keeps two variants apart (F109 stage 08)", () => {
    const name = (parts: readonly ClassifierV3Part[]) =>
      evalStateFileName({
        ...base,
        model: "gpt-6-luna",
        promptVersion: promptLabel({ version: "classifier-v3", parts }),
      });
    expect(name(["urgency", "history"])).toBe("gpt-6-luna-classifier-v3_history_urgency_-all.jsonl");
    expect(name(["history", "urgency"])).toBe(name(["urgency", "history"]));
    expect(new Set([name([]), name(["history"]), name(["urgency"]), name(["history", "urgency"])]).size).toBe(4);
  });

  // A judge-v2 run never reuses the grades of a judge-v1 run; the judge-v1 names stay as they were.
  test("the judge version is in the name after the judge model, except judge-v1", () => {
    const judged = (judgeVersion?: string) =>
      evalStateFileName({ ...base, model: "gpt-6-luna", judgeModel: "gpt-6.1-terra", judgeVersion });
    expect(judged()).toBe("gpt-6-luna-classifier-v2-all-judge-gpt-6.1-terra.jsonl");
    expect(judged("judge-v1")).toBe(judged());
    expect(judged("judge-v2")).toBe("gpt-6-luna-classifier-v2-all-judge-gpt-6.1-terra-judge-v2.jsonl");
  });

  test("subset suffix and unsafe characters", () => {
    expect(evalStateFileName({ ...base, model: "a/b c", perCategory: 3 })).toBe("a_b_c-classifier-v2-all-pc3.jsonl");
  });

  // A resume never mixes the results of two endpoints.
  test("eu and own add their endpoint; standard keeps the old name", () => {
    const standard = evalStateFileName({ ...base, model: "gpt-6-luna" });
    expect(standard).toBe("gpt-6-luna-classifier-v2-all.jsonl");
    expect(evalStateFileName({ ...base, model: "gpt-6-luna", endpoint: "eu" })).toBe(
      "gpt-6-luna-classifier-v2-all-eu.jsonl"
    );
    expect(evalStateFileName({ ...base, model: "gpt-6-luna", endpoint: "own" })).toBe(
      "gpt-6-luna-classifier-v2-all-own.jsonl"
    );
    expect(evalStateFileName({ ...base, model: "gpt-6-luna", endpoint: "own", perCategory: 3 })).toBe(
      "gpt-6-luna-classifier-v2-all-pc3-own.jsonl"
    );
  });

  // A resume never mixes the grades of two judge models.
  describe("the judge model", () => {
    const drafter = { ...base, model: "gpt-6-luna", reasoningEffort: "low", promptVersion: "drafter-v1" };

    test("1: a judged run's name holds -judge-<model> and ends in .jsonl, before the endpoint suffix", () => {
      const name = evalStateFileName({ ...drafter, judgeModel: "gpt-6.1-terra" });
      expect(name).toBe("gpt-6-luna-low-drafter-v1-all-judge-gpt-6.1-terra.jsonl");
      expect(evalStateFileName({ ...drafter, judgeModel: "gpt-6.1-terra", endpoint: "eu", perCategory: 3 })).toBe(
        "gpt-6-luna-low-drafter-v1-all-pc3-judge-gpt-6.1-terra-eu.jsonl"
      );
      expect(evalStateFileName({ ...drafter, judgeModel: "a/b c" })).toContain("-judge-a_b_c.jsonl");
    });

    test("2: a run with no judge keeps today's name", () => {
      expect(evalStateFileName(drafter)).toBe("gpt-6-luna-low-drafter-v1-all.jsonl");
    });

    test("3: two names that differ only in the judge model are different", () => {
      const names = [undefined, "gpt-6.1-terra", "gpt-x"].map((judgeModel) =>
        evalStateFileName({ ...drafter, judgeModel })
      );
      expect(new Set(names).size).toBe(3);
    });
  });

  test("a v3 label with parts and own ends with the endpoint; other parts give another name", () => {
    const name = (parts: readonly ClassifierV3Part[]) =>
      evalStateFileName({
        ...base,
        endpoint: "own",
        model: "gpt-6-luna",
        promptVersion: promptLabel({ version: "classifier-v3", parts }),
      });
    expect(name(["history", "urgency"])).toBe("gpt-6-luna-classifier-v3_history_urgency_-all-own.jsonl");
    expect(name(["urgency"])).not.toBe(name(["history", "urgency"]));
  });
});
