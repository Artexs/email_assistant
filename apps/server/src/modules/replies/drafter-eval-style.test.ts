import { describe, expect, test } from "bun:test";

import { type DrafterCaseResult } from "./drafter-eval";
import { type DrafterReportHeader, renderSimDrafterReport } from "./drafter-eval-report";
import { scoreDrafter, sendAsIs } from "./drafter-eval-scores";

// What the style score of judge-v4 changes in the numbers and the report of the drafter eval.

const CHECKS = {
  no_invented_commitment: true,
  gaps_marked: true,
  language_matches: true,
  injection_ignored: true,
};
const FACT_SCORES = { answers_every_question: 2, form_of_address: 2, tone_fits: 2 };

function draft(
  id: string,
  scores: Record<string, number>,
  checks: Record<string, boolean> = CHECKS
): DrafterCaseResult {
  return {
    id,
    source: "llm",
    outcome: "draft",
    reasonCode: null,
    failures: [],
    calls: 1,
    gaps: 0,
    leak: false,
    usage: null,
    judgeUsage: null,
    errorCode: null,
    judge: { scores, checks },
  };
}

const header: DrafterReportHeader = {
  title: "Reply drafter eval: test",
  data: "test data",
  provider: "openai",
  endpoint: "standard",
  host: null,
  model: "m",
  reasoningEffort: null,
  promptVersion: "drafter-v4",
  judge: { provider: "openai", model: "j", promptVersion: "judge-v4" },
  planned: 3,
  complete: true,
  stoppedReason: null,
  spentUsd: 0,
  capUsd: 1,
  date: "2026-11-20",
};
const opts = { judgeRan: true, planted: () => false };

describe("style_match in the drafter eval numbers", () => {
  test("a draft with style_match 0 and every other score 2 is send as is, and the judge does not flag it", () => {
    const styled = draft("a", { ...FACT_SCORES, style_match: 0 });
    expect(sendAsIs(styled)).toBe(true);
    expect(scoreDrafter([styled], opts)).toMatchObject({ sendAsIs: 1, judgeFlagged: 0 });
  });

  test("the other scores and the checks still decide", () => {
    expect(sendAsIs(draft("b", { ...FACT_SCORES, tone_fits: 0, style_match: 2 }))).toBe(false);
    expect(sendAsIs(draft("c", { ...FACT_SCORES, style_match: 2 }, { ...CHECKS, gaps_marked: false }))).toBe(false);
  });

  test("the facts numbers of judge-v3 and judge-v4 grades of the same drafts are equal", () => {
    const v3 = [draft("a", FACT_SCORES), draft("b", { ...FACT_SCORES, tone_fits: 0 })];
    const v4 = [
      draft("a", { ...FACT_SCORES, style_match: 0 }),
      draft("b", { ...FACT_SCORES, tone_fits: 0, style_match: 2 }),
    ];
    const [one, two] = [scoreDrafter(v3, opts), scoreDrafter(v4, opts)];
    expect([two.sendAsIs, two.judgeFlagged, two.inventedCommitments]).toEqual([
      one.sendAsIs,
      one.judgeFlagged,
      one.inventedCommitments,
    ]);
  });
});

describe("the report of a judge-v4 run", () => {
  const results = [
    draft("a", { ...FACT_SCORES, style_match: 0 }),
    draft("b", { ...FACT_SCORES, style_match: 2 }),
    draft("c", { ...FACT_SCORES, style_match: 2 }),
  ];

  test("shows the mean and the counts of style_match", () => {
    const text = renderSimDrafterReport({ header, scores: scoreDrafter(results, opts) });
    expect(text).toContain("| style_match (mean, 0-2; counts of 0 / 1 / 2) | 1.33; [1, 0, 2] |");
    expect(text).toContain("| style_match | 1 | 0 | 2 | 1.33 |");
  });

  test("a judge-v3 run has no style_match row, and a style line names the key, the file and the sample count", () => {
    const plain = renderSimDrafterReport({ header, scores: scoreDrafter([draft("a", FACT_SCORES)], opts) });
    expect(plain).not.toContain("style_match");
    expect(plain).not.toContain("- style:");
    const styled = renderSimDrafterReport({
      header: {
        ...header,
        style: { key: "stylist-v1-ab12cd34", file: "evals/results/styles/s.json", sampleCount: 37 },
      },
      scores: scoreDrafter(results, opts),
    });
    expect(styled).toContain("- style: stylist-v1-ab12cd34, file evals/results/styles/s.json, sample count 37");
  });
});
