// Proof of a cut stage: the same files run before and after the cut must show the expected change in cases and no
// loss of covered lines or killed mutants.
// Usage: bun scripts/test-audit/cut-proof.ts --before <dir> [--before <dir>] --after <dir> --expect unit=<±n>,int=<±n>
//          --log <md> [--title <text>] [--data <audit data dir>]
// A run dir holds what cut-run.sh writes (unit.xml, int.xml, unit/lcov.info, int/lcov.info) and, for the mutation
// check, mutation.json. <data> holds coverage-noise.tsv and mutation-unstable.tsv (default: the audit data folder of the test audit ticket).
// Exit 0 when the case counts, the covered lines and the mutants hold; else 1 with each failure listed.
import { appendFile } from "node:fs/promises";
import { parseJunit } from "./junit";
import { parseLcov, unionHits, type FileCoverage } from "./lcov";
import { compareRuns, readReport, SURVIVED_STATUSES, type MutantRow } from "./mutation-summary";

export const LANES = ["unit", "int"] as const;
export type Lane = (typeof LANES)[number];
export type LaneCounts = Record<Lane, number>;
export type Coverage = Map<string, FileCoverage>;

export interface RunData {
  counts: LaneCounts;
  seconds: LaneCounts;
  coverage: Coverage;
  mutants: MutantRow[] | null;
}

const signed = (value: number): string => (value >= 0 ? `+${value}` : `${value}`);

// `unit=+6,int=-1`: a lane that is not named expects no change.
export function parseExpect(text: string): LaneCounts {
  const expect: LaneCounts = { unit: 0, int: 0 };
  for (const part of text.split(",")) {
    const match = /^(unit|int)=([+-]?\d+)$/.exec(part.trim());
    if (match === null) throw new Error(`--expect: cannot read "${part}" (use unit=<±n>,int=<±n>)`);
    expect[match[1] as Lane] = Number(match[2]);
  }
  return expect;
}

export function checkCounts(before: LaneCounts[], after: LaneCounts, expect: LaneCounts): string[] {
  const failures: string[] = [];
  const first = before[0];
  if (first === undefined) return ["no --before run"];
  for (const lane of LANES) {
    if (before.some((run) => run[lane] !== first[lane]))
      failures.push(`${lane}: the before runs differ in case count (${before.map((run) => run[lane]).join(", ")})`);
    const got = after[lane] - first[lane];
    if (got !== expect[lane]) failures.push(`${lane}: expected ${signed(expect[lane])}, got ${signed(got)}`);
  }
  return failures;
}

// The serial time of a lane: the `time` of the root `<testsuites>` element (Bun writes the case times as 0 for
// some cases, so the case sum is the fallback only).
export function junitSeconds(xml: string): number | null {
  const match = /<testsuites\b[^>]*\stime="([\d.]+)"/.exec(xml);
  return match === null ? null : Number(match[1]);
}

const isHelper = (path: string): boolean => path.startsWith("apps/server/test/");

// A line hit in every before run must be hit after. A line hit in some before runs only is noise, and so is each
// line of a file of the noise list. Failures read `<file> line <n>`.
export function checkLines(before: Coverage[], after: Coverage, noiseFiles: Set<string>): string[] {
  const failures: string[] = [];
  const first = before[0];
  if (first === undefined) return ["no --before run"];
  for (const [file, coverage] of [...first.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (isHelper(file) || noiseFiles.has(file)) continue;
    const hitAfter = after.get(file)?.hitLines ?? new Set<number>();
    const lost = [...coverage.hitLines]
      .filter((line) => before.every((run) => run.get(file)?.hitLines.has(line) === true) && !hitAfter.has(line))
      .sort((a, b) => a - b);
    for (const line of lost) failures.push(`${file} line ${line}`);
  }
  return failures;
}

export interface MutantCheck {
  failures: string[];
  oneSided: string[];
}

const placeOf = (mutant: string): string => mutant.slice(0, mutant.indexOf(" "));

// A mutant killed in every before run and `Survived` or `NoCoverage` after fails. `Timeout` is no change, a place
// of the unstable list is not checked, and a mutant on one side only is listed (a moved line).
export function checkMutants(before: MutantRow[][], after: MutantRow[], unstable: Set<string>): MutantCheck {
  const first = before[0];
  if (first === undefined) return { failures: [], oneSided: [] };
  const key = (m: MutantRow): string => `${m.file}:${m.line}:${m.column} ${m.mutator} ${m.replacement}`;
  const killedBefore = new Set(first.filter((m) => m.status === "Killed").map(key));
  for (const run of before.slice(1)) {
    const killed = new Set(run.filter((m) => m.status === "Killed").map(key));
    for (const mutant of killedBefore) if (!killed.has(mutant)) killedBefore.delete(mutant);
  }
  const result: MutantCheck = { failures: [], oneSided: [] };
  for (const item of compareRuns(first, after).differences) {
    if (item.first === "absent" || item.second === "absent") {
      result.oneSided.push(`${item.mutant} (${item.first} -> ${item.second})`);
    } else if (
      killedBefore.has(item.mutant) &&
      SURVIVED_STATUSES.includes(item.second) &&
      !unstable.has(placeOf(item.mutant))
    ) {
      result.failures.push(`${item.mutant}: ${item.first} -> ${item.second}`);
    }
  }
  return result;
}

export const parseTsvColumns = (text: string): string[][] =>
  text
    .split("\n")
    .slice(1)
    .filter((line) => line.trim() !== "")
    .map((line) => line.split("\t"));

const exists = (path: string): Promise<boolean> => Bun.file(path).exists();

async function readCoverage(dir: string): Promise<Coverage> {
  const read = async (lane: Lane): Promise<Coverage> => {
    const path = `${dir}/${lane}/lcov.info`;
    return (await exists(path)) ? parseLcov(await Bun.file(path).text()) : new Map();
  };
  return unionHits(await read("unit"), await read("int"));
}

async function readRun(dir: string): Promise<RunData> {
  const counts: LaneCounts = { unit: 0, int: 0 };
  const seconds: LaneCounts = { unit: 0, int: 0 };
  for (const lane of LANES) {
    const path = `${dir}/${lane}.xml`;
    if (!(await exists(path))) continue;
    const xml = await Bun.file(path).text();
    const cases = parseJunit(xml);
    counts[lane] = cases.length;
    seconds[lane] = junitSeconds(xml) ?? cases.reduce((sum, item) => sum + item.time, 0);
  }
  const mutationPath = `${dir}/mutation.json`;
  const mutants = (await exists(mutationPath)) ? readReport(await Bun.file(mutationPath).json()).mutants : null;
  return { counts, seconds, coverage: await readCoverage(dir), mutants };
}

function args(name: string): string[] {
  const values: string[] = [];
  process.argv.forEach((value, at) => {
    if (value === name && process.argv[at + 1] !== undefined) values.push(process.argv[at + 1] as string);
  });
  return values;
}

function arg(name: string): string {
  const [value] = args(name);
  if (value === undefined)
    throw new Error(`usage: cut-proof.ts --before <dir> --after <dir> --expect … --log <md> (missing ${name})`);
  return value;
}

async function defaultData(): Promise<string> {
  for (const pattern of [
    "spec/features/active/*every-test-file-is-measured*/audit/data/",
    "spec/features/done/*/*every-test-file-is-measured*/audit/data/",
  ]) {
    for await (const path of new Bun.Glob(pattern).scan({ onlyFiles: false })) return path.replace(/\/$/, "");
  }
  throw new Error("no audit data folder of the test audit ticket found; pass --data");
}

const seconds = (value: number): string => `${value.toFixed(2)} s`;

if (import.meta.main) {
  const beforeDirs = args("--before");
  if (beforeDirs.length === 0) throw new Error("usage: cut-proof.ts --before <dir> … (missing --before)");
  const afterDir = arg("--after");
  const expect = parseExpect(arg("--expect"));
  const logPath = arg("--log");
  const title = args("--title")[0] ?? `Cut proof ${new Date().toISOString()}`;
  const data = args("--data")[0] ?? (await defaultData());

  const before = await Promise.all(beforeDirs.map(readRun));
  const after = await readRun(afterDir);

  const noiseText = (await exists(`${data}/coverage-noise.tsv`))
    ? await Bun.file(`${data}/coverage-noise.tsv`).text()
    : "";
  const noiseFiles = new Set(parseTsvColumns(noiseText).map((row) => row[0] as string));
  const unstableText = (await exists(`${data}/mutation-unstable.tsv`))
    ? await Bun.file(`${data}/mutation-unstable.tsv`).text()
    : "";
  const unstable = new Set(parseTsvColumns(unstableText).map((row) => `${row[0]}:${row[1]}:${row[2]}`));

  const countFailures = checkCounts(
    before.map((run) => run.counts),
    after.counts,
    expect
  );
  const lineFailures = checkLines(
    before.map((run) => run.coverage),
    after.coverage,
    noiseFiles
  );
  const mutationBefore = before.map((run) => run.mutants);
  const mutationChecked = after.mutants !== null && mutationBefore.every((m) => m !== null);
  const mutantCheck = mutationChecked
    ? checkMutants(mutationBefore as MutantRow[][], after.mutants as MutantRow[], unstable)
    : { failures: [], oneSided: [] };

  const failures = [...countFailures, ...lineFailures, ...mutantCheck.failures];
  const base = before[0] as RunData;
  const section = [
    `## ${title}`,
    "",
    `Before: ${beforeDirs.map((dir) => `\`${dir}\``).join(", ")}. After: \`${afterDir}\`. Expected: ${LANES.map((lane) => `${lane}=${signed(expect[lane])}`).join(", ")}.`,
    "",
    "| lane | cases before | cases after | serial time before | serial time after |",
    "| --- | --- | --- | --- | --- |",
    ...LANES.map(
      (lane) =>
        `| ${lane} | ${base.counts[lane]} | ${after.counts[lane]} | ${seconds(base.seconds[lane])} | ${seconds(after.seconds[lane])} |`
    ),
    "",
    `- Case counts: ${countFailures.length === 0 ? "pass" : `FAIL (${countFailures.length})`}.`,
    `- Covered lines: ${lineFailures.length === 0 ? "pass" : `FAIL (${lineFailures.length} lines unhit after)`}; ${noiseFiles.size} noise files skipped.`,
    `- Mutants: ${mutationChecked ? (mutantCheck.failures.length === 0 ? "pass" : `FAIL (${mutantCheck.failures.length})`) : "not checked (no mutation.json on both sides)"}; ${mutantCheck.oneSided.length} on one side only.`,
    ...failures.map((line) => `  - ${line}`),
    ...mutantCheck.oneSided.map((line) => `  - one side only: ${line}`),
    "",
    `Result: ${failures.length === 0 ? "PASS" : "FAIL"}`,
    "",
  ];
  await appendFile(logPath, `${section.join("\n")}\n`);
  process.stdout.write(`${section.join("\n")}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
