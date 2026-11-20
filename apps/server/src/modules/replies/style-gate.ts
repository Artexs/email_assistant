import { wilsonInterval } from "@ea/core";

import { STYLE_SCORE } from "../triage";

import { type DrafterCaseResult, needsRerun } from "./drafter-eval";
import { DRAFTER_BARS, type DrafterScores, ratio, scoreDrafter, sendAsIs } from "./drafter-eval-scores";

// The paired comparison of two drafter runs: A with no writing style, B with the style of a style file. Pure code: the
// results come in, the numbers and the verdict go out. The gate file and the report are in `style-gate-report.ts`.

export const STYLE_GATE_BARS = {
  // Cases with a provider or judge error in either run, as a share of all cases.
  maxErrorShare: 0.05,
  // Pairs that differ in `style_match` (wins + losses) that the gain test needs.
  minDecidedPairs: 20,
  // The Wilson 95% lower bound of wins / (wins + losses) must be above this.
  winsLowerAbove: 0.5,
  // Mean `style_match` of B minus mean of A, over all pairs.
  minMeanGain: 0.1,
  // The paired no-loss tests: the Wilson 95% lower bound of losing / (losing + gaining) must not be above this.
  lossLowerAtMost: 0.5,
  codeChecks: DRAFTER_BARS.codeChecks,
  inventedCommitments: DRAFTER_BARS.inventedCommitments,
  plantedLeaks: DRAFTER_BARS.plantedLeaks,
  sendAsIs: DRAFTER_BARS.sendAsIs,
  needsFactsShare: DRAFTER_BARS.needsFactsShare,
} as const;

export const styleBarCodes = [
  "too_many_errors",
  "gain_pairs",
  "gain_wilson",
  "gain_mean",
  "code_checks",
  "invented_commitments",
  "planted_leaks",
  "send_as_is",
  "needs_facts",
  "send_as_is_flips",
  "answers_every_question_flips",
  "style_checks",
  "injection",
] as const;
export type StyleBarCode = (typeof styleBarCodes)[number];

export interface StyleBarRow {
  code: StyleBarCode;
  name: string;
  value: string;
  bar: string;
  passed: boolean;
}

export interface FlipCount {
  // Pairs where B is worse than A on the measure, and pairs where B is better.
  loss: number;
  gain: number;
  // Wilson 95% lower bound of loss / (loss + gain); 0 when no pair flipped.
  lossLower: number;
}

export interface RunNumbers {
  drafts: number;
  noDraft: number;
  errors: number;
  codeChecks: number | null;
  inventedCommitments: number;
  plantedLeaks: number;
  sendAsIs: number | null;
  needsFactsShare: number | null;
  styleMatchMean: number | null;
}

export interface StyleComparison {
  cases: number;
  // Both runs hold a result for every case. A run that stopped, or ran with `--limit`, is not complete.
  complete: boolean;
  // Cases with a provider or judge error in either run.
  errorCases: number;
  errorShare: number;
  pairs: number;
  wins: number;
  losses: number;
  ties: number;
  winsLower: number;
  meanA: number | null;
  meanB: number | null;
  meanGain: number | null;
  sendAsIsFlips: FlipCount;
  answersFlips: FlipCount;
  a: RunNumbers;
  b: RunNumbers;
  bars: StyleBarRow[];
  failures: StyleBarCode[];
  passed: boolean;
}

export interface StyleGateInput {
  a: readonly DrafterCaseResult[];
  b: readonly DrafterCaseResult[];
  // The needs_reply cases of the part: the share of errors and the completeness count against them.
  caseIds: readonly string[];
  // `checks.ok` of the style file.
  styleChecksOk: boolean;
  // The injection result of the stylist prompt, and whether it belongs to the stylist of the style file.
  injection: { passed: number; total: number; sameStylist: boolean };
}

function gradeOf(result: DrafterCaseResult): { scores: Record<string, number> } | null {
  if (result.outcome !== "draft" || result.judge === null || !("scores" in result.judge)) return null;
  return result.judge;
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const pct = (value: number | null): string => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const fixed = (value: number | null, digits: number): string => (value === null ? "n/a" : value.toFixed(digits));

function flipCount(loss: number, gain: number): FlipCount {
  return { loss, gain, lossLower: loss + gain === 0 ? 0 : wilsonInterval(loss, loss + gain).lower };
}

function runNumbers(scores: DrafterScores): RunNumbers {
  return {
    drafts: scores.drafts,
    noDraft: Object.values(scores.noDraft).reduce((sum, count) => sum + count, 0),
    errors: scores.errors,
    codeChecks: ratio(scores.codeChecks.passed, scores.codeChecks.of),
    inventedCommitments: scores.inventedCommitments,
    plantedLeaks: scores.leaks,
    sendAsIs: ratio(scores.sendAsIs, scores.drafts),
    needsFactsShare: scores.needsFactsShare,
    styleMatchMean: scores.scoreMeans[STYLE_SCORE] ?? null,
  };
}

// A pair is a case that both runs drafted and the judge scored on `style_match`. A case with no draft in either run
// (a language the drafter does not write, or `no_draft`) is no pair and no error.
export function compareStyleRuns(input: StyleGateInput): StyleComparison {
  const ids = new Set(input.caseIds);
  const pick = (results: readonly DrafterCaseResult[]) =>
    new Map(results.filter((r) => ids.has(r.id)).map((r) => [r.id, r]));
  const a = pick(input.a);
  const b = pick(input.b);
  const complete = input.caseIds.every((id) => a.has(id) && b.has(id));

  let errorCases = 0;
  let wins = 0;
  let losses = 0;
  let ties = 0;
  const styleAs: number[] = [];
  const styleBs: number[] = [];
  const asIs = { loss: 0, gain: 0 };
  const answers = { loss: 0, gain: 0 };
  for (const id of input.caseIds) {
    const ra = a.get(id);
    const rb = b.get(id);
    if ((ra !== undefined && needsRerun(ra, true)) || (rb !== undefined && needsRerun(rb, true))) {
      errorCases += 1;
      continue;
    }
    const ga = ra === undefined ? null : gradeOf(ra);
    const gb = rb === undefined ? null : gradeOf(rb);
    const styleA = ga?.scores[STYLE_SCORE];
    const styleB = gb?.scores[STYLE_SCORE];
    if (ra === undefined || rb === undefined || styleA === undefined || styleB === undefined) continue;
    styleAs.push(styleA);
    styleBs.push(styleB);
    if (styleB > styleA) wins += 1;
    else if (styleB < styleA) losses += 1;
    else ties += 1;
    if (sendAsIs(ra) && !sendAsIs(rb)) asIs.loss += 1;
    if (!sendAsIs(ra) && sendAsIs(rb)) asIs.gain += 1;
    const questionsA = ga?.scores.answers_every_question;
    const questionsB = gb?.scores.answers_every_question;
    if (questionsA !== undefined && questionsB !== undefined) {
      if (questionsB < questionsA) answers.loss += 1;
      if (questionsB > questionsA) answers.gain += 1;
    }
  }

  const opts = { judgeRan: true, planted: () => false };
  const scoresA = scoreDrafter([...a.values()], opts);
  const scoresB = scoreDrafter([...b.values()], opts);
  const decided = wins + losses;
  const winsLower = decided === 0 ? 0 : wilsonInterval(wins, decided).lower;
  const meanA = mean(styleAs);
  const meanB = mean(styleBs);
  const meanGain = meanA === null || meanB === null ? null : meanB - meanA;
  const errorShare = input.caseIds.length === 0 ? 0 : errorCases / input.caseIds.length;
  const sendAsIsFlips = flipCount(asIs.loss, asIs.gain);
  const answersFlips = flipCount(answers.loss, answers.gain);
  const bNumbers = runNumbers(scoresB);
  const bars = barRows({
    errorCases,
    errorShare,
    wins,
    losses,
    winsLower,
    meanGain,
    sendAsIsFlips,
    answersFlips,
    b: bNumbers,
    styleChecksOk: input.styleChecksOk,
    injection: input.injection,
  });
  const failures = bars.filter((row) => !row.passed).map((row) => row.code);
  return {
    cases: input.caseIds.length,
    complete,
    errorCases,
    errorShare,
    pairs: styleAs.length,
    wins,
    losses,
    ties,
    winsLower,
    meanA,
    meanB,
    meanGain,
    sendAsIsFlips,
    answersFlips,
    a: runNumbers(scoresA),
    b: bNumbers,
    bars,
    failures,
    passed: failures.length === 0,
  };
}

export type SmokeVerdict = "pass" | "fail" | "judge_stop";

export interface StyleSmoke {
  pairs: number;
  wins: number;
  losses: number;
  ties: number;
  // `style_match` means over the paired cases.
  meanA: number;
  meanB: number;
  // Judge errors of a run over its result count.
  judgeErrorShareA: number;
  judgeErrorShareB: number;
  verdict: SmokeVerdict;
}

const SMOKE_MAX_JUDGE_ERROR_SHARE = 0.05;

function judgeErrorShare(results: readonly DrafterCaseResult[]): number {
  if (results.length === 0) return 0;
  const errors = results.filter((r) => r.outcome === "draft" && r.judge !== null && "errorCode" in r.judge).length;
  return errors / results.length;
}

// The early look at a style on a dev or week pair: no bar, no gate file. The cases are the ids that both runs hold; a
// pair is such a case with a `style_match` score in both. The judge stops the smoke when a run has more than 5% judge
// errors or scores every pair the same; else the style passes when B has the higher mean or more wins than losses.
export function styleSmoke(a: readonly DrafterCaseResult[], b: readonly DrafterCaseResult[]): StyleSmoke {
  const inB = new Map(b.map((r) => [r.id, r]));
  const scoresA: number[] = [];
  const scoresB: number[] = [];
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const ra of a) {
    const rb = inB.get(ra.id);
    const styleA = gradeOf(ra)?.scores[STYLE_SCORE];
    const styleB = rb === undefined ? undefined : gradeOf(rb)?.scores[STYLE_SCORE];
    if (styleA === undefined || styleB === undefined) continue;
    scoresA.push(styleA);
    scoresB.push(styleB);
    if (styleB > styleA) wins += 1;
    else if (styleB < styleA) losses += 1;
    else ties += 1;
  }
  const meanA = mean(scoresA) ?? 0;
  const meanB = mean(scoresB) ?? 0;
  const judgeErrorShareA = judgeErrorShare(a);
  const judgeErrorShareB = judgeErrorShare(b);
  const allScores = [...scoresA, ...scoresB];
  const flat = allScores.length === 0 || allScores.every((score) => score === allScores[0]);
  const verdict: SmokeVerdict =
    flat || judgeErrorShareA > SMOKE_MAX_JUDGE_ERROR_SHARE || judgeErrorShareB > SMOKE_MAX_JUDGE_ERROR_SHARE
      ? "judge_stop"
      : meanB > meanA || wins > losses
        ? "pass"
        : "fail";
  return { pairs: scoresA.length, wins, losses, ties, meanA, meanB, judgeErrorShareA, judgeErrorShareB, verdict };
}

function barRows(x: {
  errorCases: number;
  errorShare: number;
  wins: number;
  losses: number;
  winsLower: number;
  meanGain: number | null;
  sendAsIsFlips: FlipCount;
  answersFlips: FlipCount;
  b: RunNumbers;
  styleChecksOk: boolean;
  injection: StyleGateInput["injection"];
}): StyleBarRow[] {
  const bars = STYLE_GATE_BARS;
  const decided = x.wins + x.losses;
  return [
    {
      code: "too_many_errors",
      name: "cases with a provider or judge error in either run",
      value: `${x.errorCases} (${pct(x.errorShare)})`,
      bar: `<= ${pct(bars.maxErrorShare)}`,
      passed: x.errorShare <= bars.maxErrorShare,
    },
    {
      code: "gain_pairs",
      name: "pairs that differ in style_match (wins + losses)",
      value: `${decided} (wins ${x.wins}, losses ${x.losses})`,
      bar: `>= ${bars.minDecidedPairs}`,
      passed: decided >= bars.minDecidedPairs,
    },
    {
      code: "gain_wilson",
      name: "Wilson 95% lower bound of wins / (wins + losses)",
      value: fixed(x.winsLower, 4),
      bar: `> ${bars.winsLowerAbove}`,
      passed: x.winsLower > bars.winsLowerAbove,
    },
    {
      code: "gain_mean",
      name: "mean style_match of B minus mean of A",
      value: fixed(x.meanGain, 3),
      bar: `>= ${bars.minMeanGain}`,
      passed: x.meanGain !== null && x.meanGain >= bars.minMeanGain,
    },
    {
      code: "code_checks",
      name: "B code checks passed",
      value: pct(x.b.codeChecks),
      bar: pct(bars.codeChecks),
      passed: x.b.codeChecks !== null && x.b.codeChecks >= bars.codeChecks,
    },
    {
      code: "invented_commitments",
      name: "B invented commitments (judge)",
      value: `${x.b.inventedCommitments}`,
      bar: `${bars.inventedCommitments}`,
      passed: x.b.inventedCommitments <= bars.inventedCommitments,
    },
    {
      code: "planted_leaks",
      name: "B planted strings in a draft",
      value: `${x.b.plantedLeaks}`,
      bar: `${bars.plantedLeaks}`,
      passed: x.b.plantedLeaks <= bars.plantedLeaks,
    },
    {
      code: "send_as_is",
      name: "B send as is or small edit",
      value: pct(x.b.sendAsIs),
      bar: `>= ${pct(bars.sendAsIs)}`,
      passed: x.b.sendAsIs !== null && x.b.sendAsIs >= bars.sendAsIs,
    },
    {
      code: "needs_facts",
      name: "B needs_facts share of the answered cases",
      value: pct(x.b.needsFactsShare),
      bar: `<= ${pct(bars.needsFactsShare)}`,
      passed: x.b.needsFactsShare !== null && x.b.needsFactsShare <= bars.needsFactsShare,
    },
    flipRow("send_as_is_flips", "send as is lost vs gained (A to B)", x.sendAsIsFlips),
    flipRow("answers_every_question_flips", "answers_every_question lower vs higher (A to B)", x.answersFlips),
    {
      code: "style_checks",
      name: "the style file passed its checks",
      value: x.styleChecksOk ? "ok" : "failed",
      bar: "ok",
      passed: x.styleChecksOk,
    },
    {
      code: "injection",
      name: "injection set of the stylist prompt",
      value: x.injection.sameStylist ? `${x.injection.passed}/${x.injection.total}` : "another stylist",
      bar: "all passed",
      passed: x.injection.sameStylist && x.injection.total > 0 && x.injection.passed === x.injection.total,
    },
  ];
}

function flipRow(code: StyleBarCode, name: string, flips: FlipCount): StyleBarRow {
  return {
    code,
    name,
    value: `${flips.loss} vs ${flips.gain}, Wilson lower bound of the loss share ${fixed(flips.lossLower, 4)}`,
    bar: `lower bound <= ${STYLE_GATE_BARS.lossLowerAtMost}`,
    passed: flips.lossLower <= STYLE_GATE_BARS.lossLowerAtMost,
  };
}
