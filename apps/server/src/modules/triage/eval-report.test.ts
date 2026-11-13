import {
  barCategories,
  categories,
  type Category,
  computeMetrics,
  confidenceHistogram,
  confusionMatrix,
  goNoGo,
  ruleSummary,
  thresholdSweep,
} from "@ea/core";
import type { EvalCase, LlmRole, Prediction } from "@ea/core";
import { describe, expect, test } from "bun:test";

import type { LlmCall, LlmClient, LlmUsage } from "../../platform/llm";

import { type CaseResult, type CasesEvalReport, type RealEvalReport, runEval } from "./eval";
import { evalExitCode, renderEvalReport } from "./eval-report";

const BODY_MARKER = "BODY-MARKER-9f3a";

function predictions(): Prediction[] {
  const rows: Prediction[] = [];
  for (let i = 0; i < 40; i += 1) {
    rows.push({ expected: "info", predicted: "info", modelCategory: "info", confidence: 0.9, source: "llm" });
  }
  for (let i = 0; i < 5; i += 1) {
    rows.push({ expected: "urgent", predicted: "info", modelCategory: "info", confidence: 0.9, source: "llm" });
  }
  rows.push({ expected: "spam", predicted: "spam", modelCategory: "spam", confidence: 1, source: "rule" });
  return rows;
}

function base(rows: Prediction[]) {
  const sweep = {} as CasesEvalReport["sweep"];
  const histogram = {} as CasesEvalReport["histogram"];
  for (const category of categories) {
    sweep[category] = thresholdSweep(rows, category);
    histogram[category] = confidenceHistogram(rows, category);
  }
  return {
    bar: 0.98,
    minKept: 30,
    startedAt: new Date("2026-11-05T12:00:00Z"),
    predictions: rows,
    metrics: computeMetrics(rows),
    confusion: confusionMatrix(rows),
    sweep,
    goNoGo: goNoGo(rows, { bar: 0.98, minKept: 30 }),
    ruleSummary: ruleSummary(rows),
    histogram,
    errors: 0,
    errorCodes: {},
  };
}

function caseResult(id: string, over: Partial<CaseResult> = {}): CaseResult {
  return {
    id,
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
    delegatePick: null,
    draftKind: null,
    draftMatches: null,
    ...over,
  };
}

function casesReport(over: Partial<CasesEvalReport> = {}): CasesEvalReport {
  return {
    ...base(predictions()),
    kind: "cases",
    model: "gemini-3.5-flash-lite",
    provider: "gemini",
    reasoningEffort: null,
    promptVersion: "classifier-v2",
    cases: Array.from({ length: 10 }, (_, i) => caseResult(`c${i}`)),
    complete: true,
    stoppedReason: null,
    doneCount: 10,
    totalCount: 10,
    whitelist: { passed: 10, total: 10, errors: 0 },
    injection: { passed: 3, total: 3, failedIds: [] },
    blocked: { total: 0, ids: [] },
    delegation: { pick: { right: 0, total: 0 }, draft: { right: 0, total: 0 } },
    usage: {
      avgTokensIn: 500,
      avgTokensOut: 40,
      latencyP50: 800,
      latencyP95: 1500,
      costPerMail: 0.0003,
      monthlyCostAt200: 1.8,
    },
    ...over,
  };
}

function realReport(over: Partial<RealEvalReport> = {}): RealEvalReport {
  return {
    ...base(predictions()),
    kind: "real",
    mail: "real",
    labeled: 99,
    modelFilter: null,
    modelCounts: {},
    ...over,
  };
}

function decisionOf(md: string, category: Category): string {
  const line = md.split("\n").find((l) => l.startsWith(`| ${category} |`) && l.includes("go"));
  return (line ?? "").split("|").slice(-2)[0]?.trim() ?? "";
}

describe("renderEvalReport", () => {
  test("cases: the effort line shows when set", () => {
    const md = renderEvalReport(casesReport({ provider: "openai", reasoningEffort: "low" }));
    expect(md).toContain("- provider: openai");
    expect(md).toContain("- reasoning effort: low");
  });

  test("cases: header, go/no-go rows, histogram and rule line", () => {
    const md = renderEvalReport(casesReport());
    expect(md).toContain("model: gemini-3.5-flash-lite");
    expect(md).toContain("- provider: gemini");
    expect(md).not.toContain("reasoning effort");
    expect(md).toContain("prompt version: classifier-v2");
    expect(md).toContain("bar: 98.0%");
    expect(md).toContain("minimum support: 30 kept rows per category");
    expect(md).toContain("no generation settings: results can change between runs");
    expect(md).toContain("## Confidence histogram");
    expect(md).toContain("Rule results (blocklist, no LLM call): 1, right 1, wrong 0; not in the LLM metrics.");
    for (const category of barCategories) {
      expect(decisionOf(md, category)).toMatch(/^(go|no-go|no-go: too few)$/);
    }
    expect(decisionOf(md, "info")).toBe("no-go");
    expect(decisionOf(md, "urgent")).toBe("no-go: too few");
    expect(md).toContain("Minimum support: 30 kept rows per category (user 2026-11-04).");
  });

  test("cases: the delegation row and the two delegation lines", () => {
    const rows: Prediction[] = [
      { expected: "delegation", predicted: "delegation", modelCategory: "delegation", confidence: 0.9, source: "llm" },
      { expected: "delegation", predicted: "info", modelCategory: "info", confidence: 0.9, source: "llm" },
      { expected: "info", predicted: "delegation", modelCategory: "delegation", confidence: 0.8, source: "llm" },
      { expected: "delegation", predicted: "delegation", modelCategory: "delegation", confidence: 0.4, source: "llm" },
    ];
    const md = renderEvalReport(
      casesReport({
        ...base(rows),
        delegation: { pick: { right: 9, total: 12 }, draft: { right: 11, total: 12 } },
      })
    );
    expect(md).toContain("## Delegation");
    // tp 2, fp 1, fn 1; kept at the lowest threshold 0.50: the rows with confidence 0.9 and 0.8
    expect(md).toContain("| delegation | 66.7% | 66.7% | 2 |");
    expect(md).toContain("delegate pick: 9/12");
    expect(md).toContain("draft kind: 11/12");
  });

  test("cases: the delegation lines show with zero cases", () => {
    const md = renderEvalReport(casesReport());
    expect(md).toContain("delegate pick: 0/0");
    expect(md).toContain("draft kind: 0/0");
  });

  test("cases: done count, stop reason and error line", () => {
    const md = renderEvalReport(
      casesReport({ complete: false, stoppedReason: "quota", doneCount: 7, totalCount: 10, errors: 3 })
    );
    expect(md).toContain("7 of 10 cases done (run not complete)");
    expect(md).toContain("stopped: quota");
    expect(md).toContain("3 error cases: run again with the same command to retry them");
    expect(renderEvalReport(casesReport())).not.toContain("error cases");
  });

  test("cases: a go decision", () => {
    const rows: Prediction[] = Array.from({ length: 31 }, () => ({
      expected: "info" as const,
      predicted: "info" as const,
      modelCategory: "info" as const,
      confidence: 0.9,
      source: "llm" as const,
    }));
    const md = renderEvalReport(casesReport(base(rows)));
    expect(decisionOf(md, "info")).toBe("go");
  });

  test("cases: blocked ids, injection errors, whitelist and usage", () => {
    const md = renderEvalReport(
      casesReport({
        blocked: { total: 2, ids: ["b1", "b2"] },
        errors: 1,
        errorCodes: { http_503: 1 },
        cases: [caseResult("i1", { kind: "injection", errorCode: "http_503" }), caseResult("c1")],
      })
    );
    expect(md).toContain("Blocked by the provider (llm_blocked): 2 (b1, b2), counted as predicted unsure.");
    expect(md).toContain("Injection cases: 3 of 3 passed, errors 1");
    expect(md).toContain("Errors: 1 (http_503 1)");
    expect(md).toContain("Whitelist rule: 10 of 10 correct, errors 0");
    expect(md).toContain("https://ai.google.dev/gemini-api/docs/pricing");
  });

  test("cases: whitelist errors are on the whitelist line", () => {
    const md = renderEvalReport(casesReport({ whitelist: { passed: 8, total: 9, errors: 2 } }));
    expect(md).toContain("Whitelist rule: 8 of 9 correct, errors 2");
  });

  test("cases: a synthetic case error is not on the injection line", () => {
    const md = renderEvalReport(
      casesReport({
        errors: 1,
        errorCodes: { http_503: 1 },
        cases: [caseResult("c1", { errorCode: "http_503" }), caseResult("i1", { kind: "injection" })],
      })
    );
    expect(md).toContain("Injection cases: 3 of 3 passed, errors 0");
    expect(md).toContain("Errors: 1 (http_503 1)");
  });

  test("real: header lines and no cases-only parts", () => {
    const md99 = renderEvalReport(realReport({ labeled: 99 }));
    expect(md99).toContain("99 labeled real mails");
    expect(md99).toContain("fewer than 100 real labels");
    expect(renderEvalReport(realReport({ labeled: 100 }))).not.toContain("fewer than 100 real labels");
    expect(renderEvalReport(realReport({ mail: "synthetic" }))).toContain("synthetic mail, dev check");
    expect(renderEvalReport(realReport({ labeled: 7, mail: "synthetic" }))).toContain("7 labeled synthetic mails");
    expect(md99).toContain("## Go/no-go");
    expect(md99).toContain("## Confidence histogram");
    expect(md99).toContain("Rule results (blocklist");
    expect(md99).not.toMatch(/whitelist|injection|usage/i);
    expect(decisionOf(md99, "urgent")).toBe("no-go: too few");
  });

  test("real: model filter and rows per model", () => {
    const counts = { none: 1, "gpt-6-luna": 2, "gemini-3.5-flash-lite": 3 };
    const md = renderEvalReport(realReport({ modelFilter: "gpt-6-luna", modelCounts: counts }));
    expect(md).toContain("- model filter: gpt-6-luna");
    expect(md).toContain("- rows per model: gemini-3.5-flash-lite 3, gpt-6-luna 2, none 1");
    expect(renderEvalReport(realReport({ modelCounts: counts }))).not.toContain("model filter");
  });

  test("no case body in the output", async () => {
    const usage: LlmUsage = {
      role: "classifier",
      promptVersion: "classifier-v2",
      model: "gemini-3.5-flash-lite",
      tokensIn: 10,
      tokensOut: 5,
      latencyMs: 20,
    };
    const llm: LlmClient = {
      modelOf: () => "gemini-3.5-flash-lite",
      async generate<T, R extends LlmRole>(_req: LlmCall<T, R>) {
        const data = {
          category: "info",
          confidence: 0.9,
          reason_code: "other",
          reason: "Because.",
          summary: BODY_MARKER,
          fields: { due_date: null, language: "en", delegate_id: null, task: null, clarification: null },
        };
        return { data: data as T, usage };
      },
    };
    const evalCase: EvalCase = {
      id: "c1",
      kind: "synthetic",
      lang: "en",
      from: "someone@sender.test",
      to: ["boss@firma.test"],
      cc: [],
      subject: "Subject",
      body: BODY_MARKER,
      thread: [],
      senderRules: [],
      delegates: [],
      expected: { category: "info" },
    };
    const report = await runEval(
      { llm, sleep: () => Promise.resolve(), now: () => new Date("2026-11-05T12:00:00Z") },
      { cases: [evalCase], model: "gemini-3.5-flash-lite", provider: "gemini", bar: 0.98, minKept: 30, retries: 0 }
    );
    const md = renderEvalReport(report);
    expect(md).not.toContain(BODY_MARKER);
  });
});

describe("evalExitCode", () => {
  test("cases rules", () => {
    expect(evalExitCode(casesReport({ whitelist: { passed: 9, total: 10, errors: 0 } }))).toBe(1);
    expect(evalExitCode(casesReport({ injection: { passed: 2, total: 3, failedIds: ["i1"] } }))).toBe(1);
    expect(
      evalExitCode(casesReport({ errors: 11, cases: Array.from({ length: 100 }, (_, i) => caseResult(`c${i}`)) }))
    ).toBe(1);
    const blocked = casesReport({ blocked: { total: 2, ids: ["a", "b"] } });
    expect(evalExitCode(blocked)).toBe(0);
    expect(evalExitCode(casesReport())).toBe(0);
    expect(evalExitCode(casesReport({ complete: false, stoppedReason: "quota" }))).toBe(2);
  });

  test("real is always 0", () => {
    expect(evalExitCode(realReport({ errors: 50 }))).toBe(0);
  });
});
