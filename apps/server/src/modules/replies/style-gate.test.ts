import { describe, expect, test } from "bun:test";

import type { DrafterCaseResult } from "./drafter-eval";
import { compareStyleRuns, type StyleGateInput, type StyleSmoke, styleSmoke } from "./style-gate";

// The paired comparison of the style gate on fixed result lines. Every case is a draft with the judge grade of
// judge-v4, unless the test says otherwise.

interface Grade {
  style: number;
  answers?: number;
  gapsMarked?: boolean;
  commitment?: boolean;
}

function draft(id: string, grade: Grade): DrafterCaseResult {
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
    judge: {
      scores: {
        answers_every_question: grade.answers ?? 2,
        form_of_address: 2,
        tone_fits: 2,
        style_match: grade.style,
      },
      checks: {
        no_invented_commitment: grade.commitment ?? true,
        gaps_marked: grade.gapsMarked ?? true,
        language_matches: true,
        injection_ignored: true,
      },
    },
  };
}

function other(id: string, patch: Partial<DrafterCaseResult>): DrafterCaseResult {
  return { ...draft(id, { style: 0 }), judge: null, ...patch };
}

const GOOD_INJECTION = { passed: 8, total: 8, sameStylist: true };

// Cases `c0`, `c1`, ... : `a[i]` and `b[i]` are the results of the two runs for case `i`.
function compare(pairs: { a: DrafterCaseResult; b: DrafterCaseResult }[], patch: Partial<StyleGateInput> = {}) {
  const caseIds = pairs.map((_, index) => `c${index}`);
  return compareStyleRuns({
    a: pairs.map((pair, index) => ({ ...pair.a, id: `c${index}` })),
    b: pairs.map((pair, index) => ({ ...pair.b, id: `c${index}` })),
    caseIds,
    styleChecksOk: true,
    injection: GOOD_INJECTION,
    ...patch,
  });
}

// `count` pairs that go from style score `from` to `to`.
function moves(count: number, from: number, to: number, extra: { a?: Grade; b?: Grade } = {}) {
  return Array.from({ length: count }, () => ({
    a: draft("x", { style: from, ...extra.a }),
    b: draft("x", { style: to, ...extra.b }),
  }));
}

describe("compareStyleRuns: the gain", () => {
  test("30 wins and 10 losses with the means 1.0 and 1.4 pass, with the Wilson lower bound 0.5981", () => {
    const result = compare([...moves(26, 1, 2), ...moves(4, 0, 1), ...moves(4, 2, 0), ...moves(6, 1, 0)]);
    expect(result.wins).toBe(30);
    expect(result.losses).toBe(10);
    expect(result.meanA).toBe(1);
    expect(result.meanB).toBe(1.4);
    expect(result.winsLower).toBeCloseTo(0.5981, 4);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  test("12 wins and 8 losses fail on the Wilson lower bound 0.3866 alone", () => {
    const result = compare([...moves(12, 1, 2), ...moves(8, 2, 1)]);
    expect(result.winsLower).toBeCloseTo(0.3866, 4);
    expect(result.failures).toEqual(["gain_wilson"]);
  });

  test("16 wins and no loss fail because fewer than 20 pairs differ", () => {
    const result = compare(moves(16, 1, 2));
    expect(result.wins).toBe(16);
    expect(result.failures).toEqual(["gain_pairs"]);
  });

  test("a gain of 40 wins and 0 losses with a mean gain of 0.05 fails on the mean", () => {
    const result = compare([...moves(40, 1, 2), ...moves(760, 1, 1)]);
    expect(result.meanGain).toBeCloseTo(0.05, 10);
    expect(result.failures).toEqual(["gain_mean"]);
  });

  test("ties are pairs but not wins or losses", () => {
    const result = compare([...moves(50, 1, 2), ...moves(5, 2, 2)]);
    expect([result.pairs, result.wins, result.losses, result.ties]).toEqual([55, 50, 0, 5]);
  });
});

describe("compareStyleRuns: no loss on facts", () => {
  test("one invented commitment in B fails although the gain passes", () => {
    const result = compare([...moves(39, 1, 2), ...moves(1, 1, 2, { b: { style: 2, commitment: false } })]);
    expect(result.failures).toEqual(["invented_commitments"]);
  });

  test("20 pairs that lose send as is against 5 that gain fail the paired test with the lower bound 0.6087", () => {
    const result = compare([
      ...moves(60, 1, 2),
      ...moves(20, 1, 1, { b: { style: 1, gapsMarked: false } }),
      ...moves(5, 1, 1, { a: { style: 1, gapsMarked: false } }),
      ...moves(115, 1, 1),
    ]);
    expect(result.sendAsIsFlips.loss).toBe(20);
    expect(result.sendAsIsFlips.gain).toBe(5);
    expect(result.sendAsIsFlips.lossLower).toBeCloseTo(0.6087, 4);
    expect(result.failures).toEqual(["send_as_is_flips"]);
  });

  test("6 pairs that lose send as is against 4 that gain pass with the lower bound 0.3127", () => {
    const result = compare([
      ...moves(60, 1, 2),
      ...moves(6, 1, 1, { b: { style: 1, gapsMarked: false } }),
      ...moves(4, 1, 1, { a: { style: 1, gapsMarked: false } }),
      ...moves(130, 1, 1),
    ]);
    expect(result.sendAsIsFlips.lossLower).toBeCloseTo(0.3127, 4);
    expect(result.failures).toEqual([]);
  });

  test("a lower answers_every_question score in 20 pairs against a higher one in 5 fails its own paired test", () => {
    const result = compare([
      ...moves(60, 1, 2),
      ...moves(20, 1, 1, { b: { style: 1, answers: 1 } }),
      ...moves(5, 1, 1, { a: { style: 1, answers: 1 } }),
      ...moves(115, 1, 1),
    ]);
    expect(result.answersFlips.lossLower).toBeCloseTo(0.6087, 4);
    expect(result.failures).toEqual(["answers_every_question_flips"]);
  });

  test("a style file that failed its checks, or an injection result of another stylist, fails", () => {
    const pairs = [...moves(26, 1, 2), ...moves(4, 0, 1), ...moves(4, 2, 0), ...moves(6, 1, 0)];
    expect(compare(pairs, { styleChecksOk: false }).failures).toEqual(["style_checks"]);
    expect(compare(pairs, { injection: { ...GOOD_INJECTION, sameStylist: false } }).failures).toEqual(["injection"]);
    expect(compare(pairs, { injection: { passed: 7, total: 8, sameStylist: true } }).failures).toEqual(["injection"]);
  });
});

describe("compareStyleRuns: errors and cases with no draft", () => {
  test("a judge error in A on 6% of the cases fails with too_many_errors and leaves those cases out of the pairs", () => {
    const result = compare([
      ...moves(40, 1, 2),
      ...Array.from({ length: 6 }, () => ({
        a: other("x", { judge: { errorCode: "judge_failed" } }),
        b: draft("x", { style: 2 }),
      })),
      ...moves(54, 1, 1),
    ]);
    expect(result.errorCases).toBe(6);
    expect(result.pairs).toBe(94);
    expect(result.failures).toEqual(["too_many_errors"]);
  });

  test("a provider error in B on exactly 5% of the cases is within the limit", () => {
    const result = compare([
      ...moves(40, 1, 2),
      ...Array.from({ length: 5 }, () => ({
        a: draft("x", { style: 1 }),
        b: other("x", { outcome: "error", errorCode: "provider_failed" }),
      })),
      ...moves(55, 1, 1),
    ]);
    expect(result.errorShare).toBe(0.05);
    expect(result.failures).toEqual([]);
  });

  test("6% no_draft in B with no error is not too_many_errors and is not a pair", () => {
    const result = compare([
      ...moves(40, 1, 2),
      ...Array.from({ length: 6 }, () => ({
        a: draft("x", { style: 1 }),
        b: other("x", { outcome: "no_draft", reasonCode: "needs_facts" }),
      })),
      ...moves(54, 1, 1),
    ]);
    expect(result.errorCases).toBe(0);
    expect(result.pairs).toBe(94);
    expect(result.b.noDraft).toBe(6);
    expect(result.failures).toEqual([]);
  });

  test("a case with no result in a run makes the comparison incomplete", () => {
    const result = compareStyleRuns({
      a: [draft("c0", { style: 1 })],
      b: [],
      caseIds: ["c0"],
      styleChecksOk: true,
      injection: GOOD_INJECTION,
    });
    expect(result.complete).toBe(false);
  });
});

describe("styleSmoke", () => {
  // Twenty cases: A scores 2 on 17 of them and 1 on the last three. `withScores` changes single cases.
  const base = (): number[] => [...Array.from({ length: 17 }, () => 2), 1, 1, 1];
  const runOf = (scores: number[], failedJudge: number[] = []): DrafterCaseResult[] =>
    scores.map((style, index) =>
      failedJudge.includes(index)
        ? other(`c${index}`, { judge: { errorCode: "judge_failed" } })
        : draft(`c${index}`, { style })
    );
  const withScores = (changes: Record<number, number>): number[] =>
    base().map((score, index) => changes[index] ?? score);

  const table: [string, DrafterCaseResult[], DrafterCaseResult[], StyleSmoke][] = [
    [
      "equal means with one win and one loss fail",
      runOf(base()),
      runOf(withScores({ 0: 1, 17: 2 })),
      {
        pairs: 20,
        wins: 1,
        losses: 1,
        ties: 18,
        meanA: 1.85,
        meanB: 1.85,
        judgeErrorShareA: 0,
        judgeErrorShareB: 0,
        verdict: "fail",
      },
    ],
    [
      "a higher mean of B passes",
      runOf(base()),
      runOf(withScores({ 17: 2 })),
      {
        pairs: 20,
        wins: 1,
        losses: 0,
        ties: 19,
        meanA: 1.85,
        meanB: 1.9,
        judgeErrorShareA: 0,
        judgeErrorShareB: 0,
        verdict: "pass",
      },
    ],
    [
      "equal means with more wins than losses pass",
      runOf(base()),
      runOf(withScores({ 0: 0, 1: 1, 17: 2, 18: 2, 19: 2 })),
      {
        pairs: 20,
        wins: 3,
        losses: 2,
        ties: 15,
        meanA: 1.85,
        meanB: 1.85,
        judgeErrorShareA: 0,
        judgeErrorShareB: 0,
        verdict: "pass",
      },
    ],
    [
      "a lower mean of B with no wins fails",
      runOf(base()),
      runOf(withScores({ 0: 1, 1: 1 })),
      {
        pairs: 20,
        wins: 0,
        losses: 2,
        ties: 18,
        meanA: 1.85,
        meanB: 1.75,
        judgeErrorShareA: 0,
        judgeErrorShareB: 0,
        verdict: "fail",
      },
    ],
    [
      "two judge errors in A of 20 (share 0.10) stop the smoke",
      runOf(base(), [18, 19]),
      runOf(withScores({ 17: 2 })),
      {
        pairs: 18,
        wins: 1,
        losses: 0,
        ties: 17,
        meanA: 35 / 18,
        meanB: 2,
        judgeErrorShareA: 0.1,
        judgeErrorShareB: 0,
        verdict: "judge_stop",
      },
    ],
    [
      "every score 2 in both runs stops the smoke",
      runOf(Array.from({ length: 20 }, () => 2)),
      runOf(Array.from({ length: 20 }, () => 2)),
      {
        pairs: 20,
        wins: 0,
        losses: 0,
        ties: 20,
        meanA: 2,
        meanB: 2,
        judgeErrorShareA: 0,
        judgeErrorShareB: 0,
        verdict: "judge_stop",
      },
    ],
    [
      "one judge error in A of 20 (share 0.05, not above the line) leaves 19 pairs and passes",
      runOf(base(), [19]),
      runOf(withScores({ 17: 2 })),
      {
        pairs: 19,
        wins: 1,
        losses: 0,
        ties: 18,
        meanA: 36 / 19,
        meanB: 37 / 19,
        judgeErrorShareA: 0.05,
        judgeErrorShareB: 0,
        verdict: "pass",
      },
    ],
  ];

  test.each(table)("%s", (_name, a, b, expected) => {
    expect(styleSmoke(a, b)).toEqual(expected);
  });

  test("the cases are the ids that both runs hold; a run with no pair stops the smoke", () => {
    const a = runOf(base()).slice(0, 10);
    const b = runOf(withScores({ 17: 2 })).slice(5);
    expect(styleSmoke(a, b)).toMatchObject({ pairs: 5, wins: 0, verdict: "judge_stop" });
    expect(styleSmoke(a, [])).toMatchObject({ pairs: 0, meanA: 0, meanB: 0, verdict: "judge_stop" });
  });
});
