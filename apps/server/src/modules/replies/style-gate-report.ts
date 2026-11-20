import { z } from "zod";

import { type RunNumbers, STYLE_GATE_BARS, type StyleComparison, styleBarCodes } from "./style-gate";

// The gate file and the report of the style gate. Both hold counts, rates and codes only: no case id, no mail text, no
// draft text and no style text.

export interface StyleGateRun {
  // The state file the run was read from, as the caller gave it.
  file: string;
  styleKey: string;
}

export interface StyleGateHeader {
  scenario: string;
  version: string;
  manifestSha: string | null;
  date: string;
  drafter: { promptVersion: string; model: string; reasoningEffort: string | null; endpoint: string };
  judge: { model: string; promptVersion: string };
  stylist: { promptVersion: string; model: string; reasoningEffort: string | null };
  styleFile: string;
  styleSampleCount: number;
  injectionFile: string;
  runA: StyleGateRun;
  runB: StyleGateRun;
}

const safe = (part: string): string => part.replace(/[^\w.-]/g, "_");

// `stylist-<prompt version>-<model>-<effort>-<scenario>-v<corpus version>.json`: the shape of the other gate files.
export function styleGateFileName(header: Pick<StyleGateHeader, "stylist" | "scenario" | "version">): string {
  const parts = [
    "stylist",
    header.stylist.promptVersion,
    header.stylist.model,
    header.stylist.reasoningEffort ?? "default",
    header.scenario,
  ].map(safe);
  return `${parts.join("-")}-v${safe(header.version)}.json`;
}

const runNumbersSchema = z.object({
  drafts: z.number(),
  noDraft: z.number(),
  errors: z.number(),
  codeChecks: z.number().nullable(),
  inventedCommitments: z.number(),
  plantedLeaks: z.number(),
  sendAsIs: z.number().nullable(),
  needsFactsShare: z.number().nullable(),
  styleMatchMean: z.number().nullable(),
});

const flipSchema = z.object({ loss: z.number(), gain: z.number(), lossLower: z.number() });

export const styleGateFileSchema = z.object({
  scenario: z.string(),
  version: z.string(),
  part: z.literal("holdout"),
  manifestSha: z.string().nullable(),
  date: z.string(),
  role: z.literal("stylist"),
  stylist: z.object({ promptVersion: z.string(), model: z.string(), reasoningEffort: z.string().nullable() }),
  drafter: z.object({
    promptVersion: z.string(),
    model: z.string(),
    reasoningEffort: z.string().nullable(),
    endpoint: z.string(),
  }),
  judge: z.object({ model: z.string(), promptVersion: z.string() }),
  styleFile: z.string(),
  styleSampleCount: z.number(),
  injectionFile: z.string(),
  bars: z.object({
    maxErrorShare: z.number(),
    minDecidedPairs: z.number(),
    winsLowerAbove: z.number(),
    minMeanGain: z.number(),
    lossLowerAtMost: z.number(),
    codeChecks: z.number(),
    inventedCommitments: z.number(),
    plantedLeaks: z.number(),
    sendAsIs: z.number(),
    needsFactsShare: z.number(),
  }),
  cases: z.number(),
  numbers: z.object({
    errorCases: z.number(),
    errorShare: z.number(),
    pairs: z.number(),
    wins: z.number(),
    losses: z.number(),
    ties: z.number(),
    winsLower: z.number(),
    meanA: z.number().nullable(),
    meanB: z.number().nullable(),
    meanGain: z.number().nullable(),
    sendAsIsFlips: flipSchema,
    answersEveryQuestionFlips: flipSchema,
    a: runNumbersSchema,
    b: runNumbersSchema,
  }),
  failures: z.array(z.enum(styleBarCodes)),
  passed: z.boolean(),
});
export type StyleGateFile = z.infer<typeof styleGateFileSchema>;

export function buildStyleGateFile(comparison: StyleComparison, header: StyleGateHeader): StyleGateFile {
  return {
    scenario: header.scenario,
    version: header.version,
    part: "holdout",
    manifestSha: header.manifestSha,
    date: header.date,
    role: "stylist",
    stylist: header.stylist,
    drafter: header.drafter,
    judge: header.judge,
    styleFile: header.styleFile,
    styleSampleCount: header.styleSampleCount,
    injectionFile: header.injectionFile,
    bars: { ...STYLE_GATE_BARS },
    cases: comparison.cases,
    numbers: {
      errorCases: comparison.errorCases,
      errorShare: comparison.errorShare,
      pairs: comparison.pairs,
      wins: comparison.wins,
      losses: comparison.losses,
      ties: comparison.ties,
      winsLower: comparison.winsLower,
      meanA: comparison.meanA,
      meanB: comparison.meanB,
      meanGain: comparison.meanGain,
      sendAsIsFlips: comparison.sendAsIsFlips,
      answersEveryQuestionFlips: comparison.answersFlips,
      a: comparison.a,
      b: comparison.b,
    },
    failures: comparison.failures,
    passed: comparison.passed,
  };
}

const pct = (value: number | null): string => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const fixed = (value: number | null): string => (value === null ? "n/a" : value.toFixed(3));

function runRow(name: string, run: RunNumbers): string {
  return `| ${[
    name,
    run.drafts,
    run.noDraft,
    run.errors,
    pct(run.codeChecks),
    run.inventedCommitments,
    run.plantedLeaks,
    pct(run.sendAsIs),
    pct(run.needsFactsShare),
    fixed(run.styleMatchMean),
  ].join(" | ")} |`;
}

// What the gate decided about the gate file: `written` with its name, or `refused` with the reason.
export type StyleGateFileOutcome = { kind: "written"; name: string } | { kind: "refused"; reason: string };

export function renderStyleGateReport(input: {
  header: StyleGateHeader;
  comparison: StyleComparison;
  gateFile: StyleGateFileOutcome;
}): string {
  const { header, comparison: c, gateFile } = input;
  const { drafter, stylist } = header;
  return [
    `# Style gate: ${header.scenario} v${header.version} holdout`,
    "",
    `- Date: ${header.date}`,
    `- Drafter: ${drafter.promptVersion} on ${drafter.model} (effort ${drafter.reasoningEffort ?? "default"}, endpoint ${drafter.endpoint})`,
    `- Judge: ${header.judge.promptVersion} on ${header.judge.model}`,
    `- Stylist: ${stylist.promptVersion} on ${stylist.model} (effort ${stylist.reasoningEffort ?? "default"})`,
    `- Run A (no style): ${header.runA.file}, style key ${header.runA.styleKey}`,
    `- Run B (suggested style): ${header.runB.file}, style key ${header.runB.styleKey}`,
    `- Style file: ${header.styleFile}, from ${header.styleSampleCount} sent mails`,
    `- Injection result: ${header.injectionFile}`,
    `- Cases: ${c.cases}; both runs complete: ${c.complete ? "yes" : "no"}`,
    `- Verdict: ${c.passed ? "PASS" : `FAIL (${c.failures.join(", ")})`}`,
    `- Gate file: ${gateFile.kind === "written" ? `evals/results/gate/${gateFile.name}` : `none (${gateFile.reason})`}`,
    "",
    "## Runs",
    "",
    "| run | drafts | no_draft | errors | code checks | invented commitments | planted leaks | send as is | needs_facts share | style_match mean (paired) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    runRow("A", { ...c.a, styleMatchMean: c.meanA }),
    runRow("B", { ...c.b, styleMatchMean: c.meanB }),
    "",
    "## Pairs",
    "",
    `A pair is a case that both runs drafted and the judge scored: ${c.pairs} of ${c.cases} cases. B wins ${c.wins}, loses ${c.losses}, ties ${c.ties}.`,
    "",
    "## Bars",
    "",
    "| bar | value | needs | result |",
    "| --- | --- | --- | --- |",
    ...c.bars.map((row) => `| ${row.name} | ${row.value} | ${row.bar} | ${row.passed ? "pass" : "fail"} |`),
    "",
  ].join("\n");
}
