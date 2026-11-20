import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

import { llmEffortLevels } from "@ea/core";
import { z } from "zod";

import {
  buildStyleGateFile,
  compareStyleRuns,
  type DrafterCaseResult,
  parseDrafterResults,
  renderStyleGateReport,
  type SmokePair,
  smokePairs,
  type StyleComparison,
  type StyleGateFileOutcome,
  type StyleGateHeader,
  type StyleSmoke,
  styleGateFileName,
  styleSmoke,
} from "../../modules/replies";
import type { CliRawOutput } from "../../platform/cli";
import type { StyleGateArgs } from "../eval-style-gate-args";

import { keyOfFile, STYLE_NONE, STYLE_SCENARIO, styleFileSchema } from "./eval-drafter-style";
import { loadSimCases } from "./eval-sim-load";

const root = resolve(import.meta.dir, "../../../../..");
const simRoot = resolve(root, "evals/sim");
const gateDir = resolve(root, "evals/results/gate");

const JUDGE_VERSION = "judge-v4";

// What the name of a drafter state file says about its run: the only record of the run options that the file keeps.
// It is the inverse of `evalStateFileName` for the names that `eval --drafter` writes.
export interface DrafterStateName {
  model: string;
  reasoningEffort: string | null;
  drafterPrompt: string;
  scenario: string;
  version: string;
  part: string;
  // `none`, `scenario`, or the key of a style file (`<prompt version>-<hash>`).
  style: string;
  judgeModel: string | null;
  judgeVersion: string | null;
  endpoint: "standard" | "eu" | "own";
}

const efforts = llmEffortLevels.join("|");
const STATE_NAME = new RegExp(
  `^(?<model>.+?)(?:-(?<effort>${efforts}))?-(?<prompt>drafter-v\\d+)-drafter-sim-(?<scenario>[a-z0-9-]+?)-v(?<version>[\\w.]+?)-(?<part>dev|holdout|week)(?:-style-(?<style>.+?))?(?:-judge-(?<judgeModel>.+?)(?:-(?<judgeVersion>judge-v\\d+))?)?(?:-(?<endpoint>eu|own))?\\.jsonl$`
);

export function parseDrafterStateName(file: string): DrafterStateName | null {
  const groups = STATE_NAME.exec(basename(file))?.groups;
  if (groups === undefined) return null;
  return {
    model: groups.model ?? "",
    reasoningEffort: groups.effort ?? null,
    drafterPrompt: groups.prompt ?? "",
    scenario: groups.scenario ?? "",
    version: groups.version ?? "",
    part: groups.part ?? "",
    style: groups.style ?? STYLE_SCENARIO,
    judgeModel: groups.judgeModel ?? null,
    judgeVersion: groups.judgeVersion ?? null,
    endpoint: (groups.endpoint as DrafterStateName["endpoint"] | undefined) ?? "standard",
  };
}

// Why the pair of runs may not write the gate file, or null. The gate file stands for a full measure of the style:
// two judged holdout runs of the same drafter and judge that differ in the style alone.
export function runPairRefusal(a: DrafterStateName, b: DrafterStateName, styleKey: string): string | null {
  if (a.part !== "holdout" || b.part !== "holdout") return "a run is not a holdout run";
  return pairDifference(a, b, styleKey);
}

// The pair rules that hold in both modes: the judge, the style keys and every option that must be the same.
function pairDifference(a: DrafterStateName, b: DrafterStateName, styleKey: string): string | null {
  if (a.judgeModel === null || b.judgeModel === null) return "a run has no judge";
  if (a.judgeVersion !== JUDGE_VERSION || b.judgeVersion !== JUDGE_VERSION)
    return `a run does not use ${JUDGE_VERSION}`;
  if (a.style !== STYLE_NONE) return "run A does not have the style key none";
  if (b.style !== styleKey) return "run B does not have the style key of the style file";
  const same = [
    ["drafter prompt", a.drafterPrompt, b.drafterPrompt],
    ["drafter model", a.model, b.model],
    ["drafter effort", a.reasoningEffort, b.reasoningEffort],
    ["endpoint", a.endpoint, b.endpoint],
    ["judge model", a.judgeModel, b.judgeModel],
    ["corpus", `${a.scenario}-${a.version}`, `${b.scenario}-${b.version}`],
  ] as const;
  const differs = same.find(([, left, right]) => left !== right);
  return differs === undefined ? null : `the runs differ in the ${differs[0]}`;
}

const injectionResultSchema = z.object({
  promptVersion: z.string().min(1),
  model: z.string(),
  effort: z.string().nullable(),
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  usd: z.number(),
});

// The path as the repository sees it; a file outside the repository keeps the path the caller gave.
function repoPath(file: string): string {
  const inside = relative(root, resolve(file));
  return inside.startsWith("..") ? file : inside;
}

// What a test replaces: the paths and the corpus.
export interface StyleGateDeps {
  out: Pick<CliRawOutput, "print" | "fail" | "write">;
  gateDir?: string;
  now?: () => Date;
  // The needs_reply case ids of the frozen holdout of a scenario, its version and its manifest hash.
  holdout?: (scenario: string) => Promise<{ ids: string[]; version: string; manifestSha: string | null }>;
}

async function loadHoldout(scenario: string) {
  const loaded = await loadSimCases({ root: simRoot, scenario, part: "holdout", requireManifest: true });
  return {
    ids: loaded.cases.filter((c) => c.expected.category === "needs_reply").map((c) => c.id),
    version: loaded.version,
    manifestSha: loaded.manifestSha,
  };
}

// An input file that cannot be used. The text names the file and the problem, never its content.
class StyleGateInputError extends Error {}

function readJson<T>(file: string, schema: z.ZodType<T>, what: string): T {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new StyleGateInputError(`${what} ${file} cannot be read as JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new StyleGateInputError(`${what} ${file} has no valid shape`);
  return parsed.data;
}

function readRun(file: string): DrafterCaseResult[] {
  try {
    return parseDrafterResults(readFileSync(file, "utf8"));
  } catch {
    throw new StyleGateInputError(`state file ${file} cannot be read`);
  }
}

// Exit 0: the gate file is written and every bar holds. Exit 1: a bar failed, the runs are not eligible for the gate
// file (the report is still written), or an input did not load.
export async function runStyleGate(args: StyleGateArgs, deps: StyleGateDeps): Promise<number> {
  const { out } = deps;
  try {
    return args.smoke ? smoke(args, deps) : await compare(args, deps);
  } catch (error) {
    if (!(error instanceof StyleGateInputError)) throw error;
    out.fail(error.message);
    return 1;
  }
}

async function compare(args: StyleGateArgs, deps: StyleGateDeps): Promise<number> {
  const { out } = deps;
  const style = readJson(args.style, styleFileSchema, "style file");
  if (args.injection === null) throw new StyleGateInputError("missing argument: --injection");
  const injectionPath = args.injection;
  const injection = readJson(injectionPath, injectionResultSchema, "injection result file");
  const nameA = parseDrafterStateName(args.a);
  const nameB = parseDrafterStateName(args.b);
  if (nameA === null || nameB === null) {
    throw new StyleGateInputError(
      "a state file name is not the name of a drafter state file: use the file that eval --drafter wrote"
    );
  }
  const holdout = await (deps.holdout ?? loadHoldout)(nameA.scenario);
  const comparison = compareStyleRuns({
    a: readRun(args.a),
    b: readRun(args.b),
    caseIds: holdout.ids,
    styleChecksOk: style.checks.ok,
    injection: {
      passed: injection.passed,
      total: injection.total,
      sameStylist:
        injection.promptVersion === style.promptVersion &&
        injection.model === style.model &&
        injection.effort === style.effort,
    },
  });

  const styleKey = keyOfFile(style.promptVersion, style.text);
  const refusal =
    runPairRefusal(nameA, nameB, styleKey) ??
    (nameA.version !== holdout.version ? "the runs are not of the frozen version of the corpus" : null) ??
    (comparison.complete ? null : "a run has no result for every case (a --limit run, or a run that stopped)");
  const header: StyleGateHeader = {
    scenario: nameA.scenario,
    version: holdout.version,
    manifestSha: holdout.manifestSha,
    date: (deps.now ?? (() => new Date()))().toISOString().slice(0, 10),
    drafter: {
      promptVersion: nameA.drafterPrompt,
      model: nameA.model,
      reasoningEffort: nameA.reasoningEffort,
      endpoint: nameA.endpoint,
    },
    judge: { model: nameA.judgeModel ?? "none", promptVersion: nameA.judgeVersion ?? "none" },
    stylist: { promptVersion: style.promptVersion, model: style.model, reasoningEffort: style.effort },
    styleFile: repoPath(args.style),
    styleSampleCount: style.sampleCount,
    injectionFile: repoPath(injectionPath),
    runA: { file: basename(args.a), styleKey: nameA.style },
    runB: { file: basename(args.b), styleKey: nameB.style },
  };

  const gateFile = writeGate(refusal, comparison, header, deps.gateDir ?? gateDir);
  const report = renderStyleGateReport({ header, comparison, gateFile });
  out.write(`${report}\n`);
  writeFileSync(args.out, report);
  if (gateFile.kind === "refused") {
    out.fail(`no gate file: ${gateFile.reason}`);
    return 1;
  }
  out.print(`gate file: evals/results/gate/${gateFile.name} passed=${comparison.passed}`);
  if (!comparison.passed) out.fail(`a bar of the style gate failed: ${comparison.failures.join(", ")}`);
  return comparison.passed ? 0 : 1;
}

function writeGate(
  refusal: string | null,
  comparison: StyleComparison,
  header: StyleGateHeader,
  dir: string
): StyleGateFileOutcome {
  if (refusal !== null) return { kind: "refused", reason: refusal };
  const name = styleGateFileName(header);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, name), `${JSON.stringify(buildStyleGateFile(comparison, header), null, 2)}\n`);
  return { kind: "written", name };
}

// Why a pair may not go through the smoke, or null: both runs are dev runs, or both are week runs, and they differ in
// the style alone. A holdout pair goes through the full gate.
function smokeRefusal(a: DrafterStateName, b: DrafterStateName, styleKey: string): string | null {
  if (a.part === "holdout" || b.part === "holdout") return "a holdout pair goes through the full gate";
  if (a.part !== b.part) return "the runs are of different parts";
  if (a.part !== "dev" && a.part !== "week") return "a run is not a dev or week run";
  return pairDifference(a, b, styleKey);
}

const SMOKE_LABEL = { pass: "pass (smoke)", fail: "fail (smoke)", judge_stop: "judge stop" } as const;

function renderSmokeReport(input: {
  fileA: string;
  fileB: string;
  drafterPrompt: string;
  styleFile: string;
  smoke: StyleSmoke;
  pairs: SmokePair[];
}): string {
  const { smoke } = input;
  const share = (value: number) => `${(value * 100).toFixed(1)}%`;
  return [
    "# Style smoke",
    "",
    `- Run A (no style): ${input.fileA}`,
    `- Run B (style): ${input.fileB}`,
    `- Drafter prompt: ${input.drafterPrompt}`,
    `- Style file: ${input.styleFile}`,
    "- The cases are the ones the drafter prompt was tuned on: this is a smoke, not a gate, and no gate file is written.",
    "",
    `Pairs: ${smoke.pairs} (wins ${smoke.wins}, losses ${smoke.losses}, ties ${smoke.ties})`,
    `style_match mean: A ${smoke.meanA.toFixed(2)}, B ${smoke.meanB.toFixed(2)}`,
    `Judge error share: A ${share(smoke.judgeErrorShareA)}, B ${share(smoke.judgeErrorShareB)}`,
    `Verdict: ${SMOKE_LABEL[smoke.verdict]}`,
    "",
    "## Pairs (style_match of A, then B)",
    "",
    ...input.pairs.map((pair) => `- ${pair.id}: ${pair.a}, ${pair.b}`),
  ].join("\n");
}

// Exit 0: the style passes. Exit 1: it fails or the judge stops the smoke. Exit 2: the pair is not a smoke pair. It
// reads no holdout case and writes no gate file.
function smoke(args: StyleGateArgs, deps: StyleGateDeps): number {
  const { out } = deps;
  const style = readJson(args.style, styleFileSchema, "style file");
  const nameA = parseDrafterStateName(args.a);
  const nameB = parseDrafterStateName(args.b);
  if (nameA === null || nameB === null) {
    throw new StyleGateInputError(
      "a state file name is not the name of a drafter state file: use the file that eval --drafter wrote"
    );
  }
  const refusal = smokeRefusal(nameA, nameB, keyOfFile(style.promptVersion, style.text));
  if (refusal !== null) {
    out.fail(refusal);
    return 2;
  }
  const a = readRun(args.a);
  const b = readRun(args.b);
  const result = styleSmoke(a, b);
  const report = renderSmokeReport({
    fileA: basename(args.a),
    fileB: basename(args.b),
    drafterPrompt: nameA.drafterPrompt,
    styleFile: repoPath(args.style),
    smoke: result,
    pairs: smokePairs(a, b),
  });
  out.write(`${report}\n`);
  writeFileSync(args.out, report);
  out.print(`style smoke: ${SMOKE_LABEL[result.verdict]}`);
  return result.verdict === "pass" ? 0 : 1;
}
