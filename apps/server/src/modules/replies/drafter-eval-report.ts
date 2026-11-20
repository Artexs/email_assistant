import type { LlmEndpointKind } from "@ea/core";
import { z } from "zod";

import { STYLE_SCORE } from "../triage";

import {
  DRAFTER_BARS,
  type DrafterScores,
  gatePassed,
  type InjectionSummary,
  type LanguageRow,
  pct,
  ratio,
  simBars,
} from "./drafter-eval-scores";
import type { FactsVerdict } from "./reply-facts";

// The report and the gate file of the drafter eval. A holdout report has counts and rates only: no case id, no mail
// text, no draft text.

const usd = (value: number): string => `$${value.toFixed(4)}`;
export interface DrafterReportHeader {
  title: string;
  // A line that names the data: the corpus part or the set.
  data: string;
  provider: string;
  endpoint: LlmEndpointKind;
  host: string | null;
  model: string;
  reasoningEffort: string | null;
  promptVersion: string;
  judge: { provider: string; model: string; promptVersion: string } | null;
  // The writing style the drafter got: `scenario` (the corpus voice), `none`, or a style file.
  style?: { key: string; file: string | null; sampleCount: number | null };
  planned: number;
  complete: boolean;
  stoppedReason: string | null;
  spentUsd: number;
  capUsd: number | null;
  date: string;
}

const row = (cells: (string | number)[]): string => `| ${cells.join(" | ")} |`;

function table(head: string[], rows: (string | number)[][]): string[] {
  return [row(head), row(head.map(() => "---")), ...rows.map(row), ""];
}

const counts = (record: Record<string, number>): string =>
  Object.keys(record).length === 0
    ? "none"
    : Object.keys(record)
        .sort()
        .map((key) => `${key} ${record[key]}`)
        .join(", ");

function styleLine(style: NonNullable<DrafterReportHeader["style"]>): string {
  if (style.file === null) return style.key;
  return `${style.key}, file ${style.file}, sample count ${style.sampleCount ?? "n/a"}`;
}

function headerLines(h: DrafterReportHeader): string[] {
  return [
    `# ${h.title}`,
    "",
    `- date: ${h.date}`,
    "- role: drafter",
    `- model: ${h.model}`,
    `- provider: ${h.provider}`,
    `- endpoint: ${h.endpoint}${h.host === null ? "" : ` (${h.host})`}`,
    `- reasoning effort: ${h.reasoningEffort ?? "default"}`,
    `- prompt version: ${h.promptVersion}`,
    `- judge: ${h.judge === null ? "not run" : `${h.judge.provider} ${h.judge.model}, ${h.judge.promptVersion}, rubric reply`}`,
    ...(h.style === undefined ? [] : [`- style: ${styleLine(h.style)}`]),
    `- data: ${h.data}`,
    `- ${h.planned} cases planned, ${h.complete ? "run complete" : `run NOT complete (${h.stoppedReason ?? "stopped"})`}`,
    `- cost: ${usd(h.spentUsd)} of cap ${h.capUsd === null ? "none (own endpoint)" : usd(h.capUsd)}`,
    "",
  ];
}

// A diagnostic of the judge: the share of `language_matches` false by case language, and the send-as-is rate without that check.
function languageRows(scores: DrafterScores): [string, string][] {
  return Object.keys(scores.byLanguage)
    .sort()
    .map((language) => {
      const row = scores.byLanguage[language] as LanguageRow;
      return [
        `language ${language}: drafts / language_matches false / send as is / send as is without that check`,
        `${row.drafts} / ${row.languageFalse} / ${row.sendAsIs} / ${row.sendAsIsWithoutLanguage}`,
      ];
    });
}

// What the judge adds to the code checks, and the score counts that a later tone change is measured against.
function judgeGainLines(scores: DrafterScores): string[] {
  const names = Object.keys(scores.scoreCounts).sort();
  return [
    "### Judge gain over the code checks",
    "",
    `- Drafts that passed every code check: ${scores.drafts}. Graded: ${scores.graded}. The judge flags ${scores.judgeFlagged} of them (a score 0 or a check false): ${pct(ratio(scores.judgeFlagged, scores.graded))}. The code checks alone would let all ${scores.drafts} through.`,
    "",
    ...table(
      ["score", "0", "1", "2", "mean"],
      names.map((name) => {
        const [zero, one, two] = scores.scoreCounts[name] as [number, number, number];
        const total = zero + one + two;
        return [name, zero, one, two, total === 0 ? "n/a" : ((one + 2 * two) / total).toFixed(2)];
      })
    ),
    "These counts are the baseline of a tone gain (`tone_fits`) with no loss on facts (`answers_every_question`, `no_invented_commitment`).",
    "",
  ];
}

// Only a run with judge-v4 has the score `style_match`; judge-v3 reports do not change.
function styleMatchRows(scores: DrafterScores, mean: string): (string | number)[][] {
  const counted = scores.scoreCounts[STYLE_SCORE];
  if (counted === undefined) return [];
  return [[`${STYLE_SCORE} (mean, 0-2; counts of 0 / 1 / 2)`, `${mean}; [${counted.join(", ")}]`]];
}

// The shape of the drafts: full sentences against skeleton, and the sentences that lean toward a commitment. A measure
// only; no bar reads it. The leaning ids are case ids, allowed in every report (never text).
function sentenceLines(scores: DrafterScores): string[] {
  const s = scores.sentences;
  const mean = s.measured === 0 ? "n/a" : (s.proseTotal / s.measured).toFixed(2);
  return [
    "## Sentences",
    "",
    `- drafts with a full sentence: ${s.withProse} of ${s.measured}`,
    `- skeleton drafts: ${s.skeleton} of ${s.measured}`,
    `- mean prose sentences: ${mean}`,
    `- leaning sentences: ${s.leaning}`,
    ...(s.leaning > 0 ? [`- leaning ids: ${s.leaningIds.join(", ")}`] : []),
    `- not measured: ${s.notMeasured}`,
    "",
  ];
}

function replyDraftLines(scores: DrafterScores): string[] {
  const mean = (name: string): string =>
    scores.scoreMeans[name] === undefined ? "n/a" : scores.scoreMeans[name].toFixed(2);
  return [
    "## Reply drafts",
    "",
    ...table(
      ["count", "value"],
      [
        ["cases with a result", scores.cases],
        ["skipped (language other than pl or en)", scores.skipped],
        ["drafted", scores.drafts],
        ["no_draft", counts(scores.noDraft)],
        ["failed (checks / unreadable answer)", `${scores.failed.checks} / ${scores.failed.output}`],
        ["check codes of failed cases", counts(scores.checkFailures)],
        ["needed the second call", scores.retried],
        ["drafter calls", scores.calls],
        ["provider error cases (run again)", scores.errors],
        ["drafts with gaps", scores.draftsWithGaps],
        ["cases with planted strings / drafts that hold one", `${scores.plantedCases} / ${scores.leaks}`],
      ]
    ),
    `Code checks: ${scores.codeChecks.passed} of ${scores.codeChecks.of} drafter runs passed them (${pct(ratio(scores.codeChecks.passed, scores.codeChecks.of))}).`,
    "",
    ...sentenceLines(scores),
    ...(scores.judgeRan ? judgeGainLines(scores) : []),
    ...(scores.judgeRan
      ? [
          "### Judge (rubric reply)",
          "",
          ...table(
            ["item", "value"],
            [
              ["drafts graded / grade errors", `${scores.graded} / ${scores.judgeErrors}`],
              ["answers_every_question (mean, 0-2)", mean("answers_every_question")],
              ["form_of_address (mean, 0-2)", mean("form_of_address")],
              ["tone_fits (mean, 0-2)", mean("tone_fits")],
              ...styleMatchRows(scores, mean("style_match")),
              ["checks false", counts(scores.checkFalse)],
              ["no_invented_commitment false", scores.inventedCommitments],
              ...languageRows(scores),
              [
                "send as is or small edit (all scores >= 1, all checks true)",
                `${scores.sendAsIs}/${scores.drafts} (${pct(ratio(scores.sendAsIs, scores.drafts))})`,
              ],
            ]
          ),
        ]
      : ["The judge did not run: no score."]),
  ];
}

function secondPassLines(scores: DrafterScores, costUsd: number, injection: string): string[] {
  const share = scores.needsFactsShare;
  return [
    "## Second pass input",
    "",
    ...table(
      ["drafter bar number", "value", "bar", "result"],
      [
        ...simBars(scores).map((bar) => [bar.name, bar.value, bar.bar, bar.passed ? "pass" : "FAIL"]),
        ["reply injection set", injection, pct(DRAFTER_BARS.injection), "see the injection report"],
      ]
    ),
    `- \`needs_facts\` share of answered cases: ${scores.noDraft.needs_facts ?? 0} of ${scores.answered} (${pct(share)}); line: ${pct(DRAFTER_BARS.needsFactsShare)} (${share !== null && share > DRAFTER_BARS.needsFactsShare ? "above the line" : "inside the line"}).`,
    `- cost per draft: ${scores.drafts === 0 ? "n/a" : usd(costUsd / scores.drafts)} (${usd(costUsd)} for ${scores.drafts} drafts, drafter and judge calls).`,
    `- drafter calls per answered case: ${scores.answered === 0 ? "n/a" : (scores.calls / scores.answered).toFixed(2)}.`,
    "",
  ];
}

/** The report of a sim part run. A holdout report (`ids` undefined) holds counts only; a dev report lists case ids to tune on. */
export function renderSimDrafterReport(input: {
  header: DrafterReportHeader;
  scores: DrafterScores;
  ids?: { failed: string[]; notAsIs: string[]; commitment: string[] };
  // A reply facts run: the verdict, and whether the judge ran (its commitment count is no bar for this set).
  facts?: { verdict: FactsVerdict; judged: boolean };
}): string {
  const { header, scores, ids, facts } = input;
  return [
    ...headerLines(header),
    ...replyDraftLines(scores),
    "",
    ...(ids === undefined
      ? []
      : [
          "## Case ids (dev only)",
          "",
          `- failed: ${ids.failed.join(", ") || "none"}`,
          `- drafts that are not send as is: ${ids.notAsIs.join(", ") || "none"}`,
          `- invented commitment: ${ids.commitment.join(", ") || "none"}`,
          "",
        ]),
    ...(facts === undefined ? [] : factsLines(facts.verdict, facts.judged)),
    ...secondPassLines(scores, header.spentUsd, "not part of this run"),
  ].join("\n");
}

// The facts verdict of the reply facts set: the failing ids with their codes, never a text.
function factsLines(verdict: FactsVerdict, judged: boolean): string[] {
  return [
    "## Reply facts",
    "",
    `- facts kept in every case: ${verdict.passed ? "pass" : "NOT met"}`,
    `- failing: ${verdict.failures.map((f) => `${f.id} (${f.code})`).join(", ") || "none"}`,
    ...(judged
      ? ["- the judge does not see the instruction line, so its invented-commitment count is no bar for this set"]
      : []),
    "",
  ];
}

/** The report of the reply injection set. The set is public text in git, so it lists the ids that did not pass. */
export function renderInjectionReport(input: {
  header: DrafterReportHeader;
  scores: DrafterScores;
  summary: InjectionSummary;
  notPassed: string[];
}): string {
  const { header, scores, summary } = input;
  const done = summary.cases > 0 && summary.open === 0;
  return [
    ...headerLines(header),
    "## Injection result",
    "",
    ...table(
      ["count", "value"],
      [
        ["cases with a result", summary.cases],
        ["passed", `${summary.passed}/${summary.cases} (${pct(ratio(summary.passed, summary.cases))})`],
        ["no_draft", summary.noDraft],
        ["failed closed (checks or unreadable answer, no draft)", summary.failedClosed],
        ["drafted (graded by the judge)", summary.drafted],
        ["no verdict yet (provider error or no grade: run again)", summary.open],
      ]
    ),
    `- not passed: ${input.notPassed.join(", ") || "none"}`,
    `- bar: ${pct(DRAFTER_BARS.injection)} (drafter bar): ${done && summary.passed === summary.cases ? "pass" : "NOT met"}`,
    "",
    ...replyDraftLines(scores),
    "",
    "## Second pass input",
    "",
    `- reply injection set: ${summary.passed}/${summary.cases} passed, bar ${pct(DRAFTER_BARS.injection)}.`,
    `- cost: ${usd(header.spentUsd)} for ${summary.cases} cases (${scores.drafts} drafts graded).`,
    "",
  ].join("\n");
}

export const drafterGateFileSchema = z.object({
  scenario: z.string(),
  version: z.string(),
  part: z.literal("holdout"),
  // The sha256 of the manifest file of the frozen corpus.
  manifestSha: z.string(),
  date: z.string(),
  role: z.literal("drafter"),
  provider: z.string(),
  endpoint: z.enum(["standard", "eu", "own"]),
  host: z.string().nullable(),
  model: z.string(),
  reasoningEffort: z.string().nullable(),
  promptVersion: z.string(),
  judge: z.object({ provider: z.string(), model: z.string(), promptVersion: z.string() }),
  bars: z.object({
    codeChecks: z.number(),
    inventedCommitments: z.number(),
    sendAsIs: z.number(),
    plantedLeaks: z.number(),
    needsFactsShare: z.number(),
  }),
  cases: z.number(),
  errors: z.number(),
  numbers: z.object({
    codeChecks: z.number().nullable(),
    inventedCommitments: z.number(),
    sendAsIs: z.number().nullable(),
    plantedLeaks: z.number(),
    needsFactsShare: z.number().nullable(),
    drafts: z.number(),
    answered: z.number(),
  }),
  passed: z.boolean(),
});
export type DrafterGateFile = z.infer<typeof drafterGateFileSchema>;

export function buildDrafterGateFile(
  scores: DrafterScores,
  id: {
    scenario: string;
    version: string;
    manifestSha: string;
    header: Pick<DrafterReportHeader, "provider" | "endpoint" | "host" | "model" | "reasoningEffort" | "promptVersion">;
    judge: { provider: string; model: string; promptVersion: string };
    now: Date;
  }
): DrafterGateFile {
  return {
    scenario: id.scenario,
    version: id.version,
    part: "holdout",
    manifestSha: id.manifestSha,
    date: id.now.toISOString().slice(0, 10),
    role: "drafter",
    provider: id.header.provider,
    endpoint: id.header.endpoint,
    host: id.header.host,
    model: id.header.model,
    reasoningEffort: id.header.reasoningEffort,
    promptVersion: id.header.promptVersion,
    judge: id.judge,
    bars: {
      codeChecks: DRAFTER_BARS.codeChecks,
      inventedCommitments: DRAFTER_BARS.inventedCommitments,
      sendAsIs: DRAFTER_BARS.sendAsIs,
      plantedLeaks: DRAFTER_BARS.plantedLeaks,
      needsFactsShare: DRAFTER_BARS.needsFactsShare,
    },
    cases: scores.cases,
    errors: scores.errors,
    numbers: {
      codeChecks: ratio(scores.codeChecks.passed, scores.codeChecks.of),
      inventedCommitments: scores.inventedCommitments,
      sendAsIs: ratio(scores.sendAsIs, scores.drafts),
      plantedLeaks: scores.leaks,
      needsFactsShare: scores.needsFactsShare,
      drafts: scores.drafts,
      answered: scores.answered,
    },
    passed: gatePassed(scores),
  };
}
