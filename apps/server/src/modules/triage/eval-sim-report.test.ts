import {
  categories,
  type Category,
  computeMetrics,
  confidenceHistogram,
  confusionMatrix,
  goNoGo,
  ruleSummary,
  thresholdSweep,
} from "@ea/core";
import { describe, expect, test } from "bun:test";

import { type CaseResult, type CasesEvalReport, toPrediction } from "./eval";
import { renderEvalReport } from "./eval-report";
import {
  buildGateFile,
  gateFileName,
  gateFileRefusal,
  gateFileSchema,
  renderSimSections,
  type SimMeta,
  type SimReportInput,
} from "./eval-sim-report";

function result(id: string, expected: Category, finalCategory: Category, over: Partial<CaseResult> = {}): CaseResult {
  return {
    id,
    kind: "synthetic",
    expected,
    modelCategory: finalCategory,
    finalCategory,
    confidence: 0.95,
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

const cases: CaseResult[] = [
  result("case-aa1", "urgent", "urgent"),
  result("case-aa2", "urgent", "urgent"),
  result("case-aa3", "urgent", "info"),
  result("case-bb1", "urgent", "urgent"),
  result("case-cc1", "urgent", "info"),
  result("case-cc2", "urgent", "needs_reply"),
  result("case-dd1", "needs_reply", "needs_reply"),
  result("case-dd2", "needs_reply", "info"),
  result("case-ee1", "info", "info"),
  result("case-ee2", "info", "info"),
  result("case-ff1", "notification", "notification"),
  result("case-inj1", "spam", "info", { kind: "injection", injectionPassed: false }),
];

const metaRows: [string, SimMeta][] = [
  ["case-aa1", { lang: "pl", part: "holdout", urgencySource: "text", hardCases: ["short"] }],
  ["case-aa2", { lang: "en", part: "holdout", urgencySource: "text", hardCases: [] }],
  ["case-aa3", { lang: "de", part: "holdout", urgencySource: "text", hardCases: ["short"] }],
  ["case-bb1", { lang: "pl", part: "holdout", urgencySource: "vip", hardCases: [] }],
  ["case-cc1", { lang: "en", part: "holdout", urgencySource: "context", hardCases: ["sarcasm"] }],
  ["case-cc2", { lang: "en", part: "holdout", urgencySource: "context", hardCases: ["sarcasm"] }],
  ["case-dd1", { lang: "pl", part: "holdout", hardCases: [] }],
  ["case-dd2", { lang: "de", part: "holdout", hardCases: [] }],
  ["case-ee1", { lang: "pl", part: "holdout", hardCases: [] }],
  ["case-ee2", { lang: "en", part: "holdout", hardCases: [] }],
  ["case-ff1", { lang: "de", part: "holdout", hardCases: [] }],
  ["case-inj1", { lang: "en", part: "holdout", hardCases: ["injection-body"] }],
];

function report(over: Partial<CasesEvalReport> = {}): CasesEvalReport {
  const rows = cases.map(toPrediction).filter((p) => p !== null);
  const sweep = {} as CasesEvalReport["sweep"];
  const histogram = {} as CasesEvalReport["histogram"];
  for (const category of categories) {
    sweep[category] = thresholdSweep(rows, category);
    histogram[category] = confidenceHistogram(rows, category);
  }
  return {
    kind: "cases",
    role: "classifier",
    bar: 0.98,
    minKept: 30,
    startedAt: new Date("2026-11-14T12:00:00Z"),
    predictions: rows,
    metrics: computeMetrics(rows),
    confusion: confusionMatrix(rows),
    sweep,
    goNoGo: goNoGo(rows, { bar: 0.98, minKept: 30 }),
    ruleSummary: ruleSummary(rows),
    histogram,
    errors: 0,
    errorCodes: {},
    model: "gpt-6-luna",
    provider: "openai",
    reasoningEffort: "none",
    promptVersion: "classifier-v2",
    cases,
    cost: { spentUsd: 1.23456, capUsd: 5, stoppedByBudget: false },
    complete: true,
    stoppedReason: null,
    doneCount: 12,
    totalCount: 12,
    whitelist: { passed: 0, total: 0, errors: 0 },
    injection: { passed: 0, total: 1, failedIds: ["case-inj1"] },
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

function input(over: Partial<SimReportInput> = {}): SimReportInput {
  return {
    report: report(),
    meta: new Map(metaRows),
    corpus: {
      scenario: "lab-01",
      version: "1.1",
      manifestSha: "0123456789abcdef0123",
      audit: "pending",
      part: "holdout",
    },
    hideIds: false,
    ...over,
  };
}

const line = (md: string, start: string): string => md.split("\n").find((l) => l.startsWith(start)) ?? "";

describe("renderSimSections", () => {
  test("has the five sections; urgent recall by source counts text 2/3, vip 1/1, context 0/2", () => {
    const md = renderSimSections(input()).join("\n");
    for (const title of [
      "## Sim gate",
      "## Missed mail",
      "## Urgent recall by source",
      "## By language",
      "## Hard cases",
    ]) {
      expect(md).toContain(title);
    }
    expect(line(md, "| text |")).toContain("| text | 3 | 2 | 66.7% |");
    expect(line(md, "| vip |")).toContain("| vip | 1 | 1 | 100.0% |");
    expect(line(md, "| context |")).toContain("| context | 2 | 0 | 0.0% |");
  });

  test("missed mail: urgent 3 of 6 missed; hard cases count an injection as right only when it passed", () => {
    const md = renderSimSections(input()).join("\n");
    const missed = md.slice(md.indexOf("## Missed mail"), md.indexOf("## Urgent recall by source"));
    expect(line(missed, "| urgent |")).toContain("| urgent | 6 | 50.0% | 50.0% | 81.2% |");
    expect(line(missed, "| needs_reply |")).toContain("| needs_reply | 2 | 50.0% | 50.0% | 90.5% |");
    expect(line(md, "| injection-body |")).toContain("| injection-body | 1 | 0 | 0.0% |");
    expect(line(md, "| sarcasm |")).toContain("| sarcasm | 2 | 0 | 0.0% |");
    expect(line(md, "| pl |")).toContain("| pl | 4 | 100.0% |");
  });
});

describe("renderEvalReport with sim", () => {
  test("the header names the corpus, audit and cost", () => {
    const md = renderEvalReport(report(), { title: "t", sim: input() });
    expect(md).toContain("- corpus: lab-01 v1.1 (holdout), manifest 0123456789ab, owner audit: pending");
    expect(md).toContain("- cost: $1.2346 of cap $5.00");
    expect(md).toContain("## Sim gate");
  });

  test("hideIds prints no case id; without it the failed injection id is present", () => {
    const hidden = renderEvalReport(report(), { sim: input({ hideIds: true }) });
    for (const [id] of metaRows) expect(hidden).not.toContain(id);
    expect(hidden).toContain("Failed injection cases: 1");
    const shown = renderEvalReport(report(), { sim: input({ hideIds: false }) });
    expect(shown).toContain("Failed injection ids: case-inj1");
  });

  test("without sim the report has no sim section", () => {
    expect(renderEvalReport(report())).not.toContain("## Sim gate");
  });
});

describe("buildGateFile", () => {
  const now = new Date("2026-11-14T13:00:00Z");

  test("parses with the schema and holds no case id", () => {
    const file = buildGateFile({ ...input(), now });
    expect(gateFileSchema.parse(file)).toEqual(file);
    const json = JSON.stringify(file);
    for (const [id] of metaRows) expect(json).not.toContain(id);
    expect(file.categories.urgent.metrics).toEqual({ tp: 3, fp: 0, fn: 3, support: 6 });
    expect(file.urgentRecallBySource.text).toEqual({ n: 3, recall: 2 / 3 });
    expect(file.injection).toEqual({ passed: 0, total: 1 });
    expect(file.date).toBe("2026-11-14");
  });

  test("provisional follows the audit", () => {
    expect(buildGateFile({ ...input(), now }).provisional).toBe(true);
    const done = input({ corpus: { ...input().corpus, audit: "done" } });
    expect(buildGateFile({ ...done, now }).provisional).toBe(false);
  });
});

describe("gateFileName", () => {
  const base = {
    role: "classifier" as const,
    promptVersion: "classifier-v2",
    model: "gpt-6-luna",
    reasoningEffort: "none" as string | null,
    scenario: "lab-01",
    version: "1.1",
  };

  test("joins the parts; a null effort is default", () => {
    expect(gateFileName(base)).toBe("classifier-classifier-v2-gpt-6-luna-none-lab-01-v1.1.json");
    expect(gateFileName({ ...base, reasoningEffort: null })).toBe(
      "classifier-classifier-v2-gpt-6-luna-default-lab-01-v1.1.json"
    );
  });

  test("a path character becomes an underscore", () => {
    expect(gateFileName({ ...base, model: "a/b c" })).toContain("-a_b_c-");
  });
});

describe("gateFileRefusal", () => {
  const defaults = { part: "holdout", bar: 0.98, "min-kept": 30 };

  test("defaults on a complete holdout run give no refusal", () => {
    expect(gateFileRefusal(defaults, report())).toBeNull();
  });

  test("a looser bar, a limit, another part, another min-kept or an incomplete run refuse", () => {
    expect(gateFileRefusal({ ...defaults, bar: 0.9 }, report())).toBe("no gate file: bar is not 0.98");
    expect(gateFileRefusal({ ...defaults, limit: 10 }, report())).toStartWith("no gate file:");
    expect(gateFileRefusal({ ...defaults, part: "dev" }, report())).toStartWith("no gate file:");
    expect(gateFileRefusal({ ...defaults, "min-kept": 10 }, report())).toStartWith("no gate file:");
    expect(gateFileRefusal(defaults, report({ complete: false }))).toStartWith("no gate file:");
  });
});
