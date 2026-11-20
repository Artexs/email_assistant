// Summary of a Stryker mutation run of packages/core: kills per test case, the greedy cover, per-file scores.
// Usage: bun scripts/test-audit/mutation-summary.ts --in <mutation.json> --data <audit data dir>
//        bun scripts/test-audit/mutation-summary.ts --compare <run-1 mutation.json> <run-2 mutation.json>
// Reads <data>/junit-cases.tsv (the scan key of each JUnit case); writes mutation-tests.tsv, mutation-files.tsv,
// mutation-survived.tsv, mutation-baseline.tsv and mutation-summary.md into <data>.

export interface MutantRow {
  file: string;
  line: number;
  column: number;
  mutator: string;
  replacement: string;
  status: string;
  killedBy: string[];
}

export interface CaseKills {
  testId: string;
  file: string;
  line: number;
  name: string;
  kills: number;
  uniqueKills: number;
  inCover: boolean;
}

export interface MutationReport {
  mutants: MutantRow[];
  tests: Map<string, { file: string; line: number; name: string }>;
}

export const CORE_PREFIX = "packages/core/";
const NAME_JOINER = " > ";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asNumber = (value: unknown): number => (typeof value === "number" ? value : 0);
const asString = (value: unknown): string => (typeof value === "string" ? value : "");

// The paths of the report are relative to the work folder (`src/…`); the rows carry the repo path.
export const repoPath = (path: string): string => (path.startsWith(CORE_PREFIX) ? path : `${CORE_PREFIX}${path}`);

export function readReport(json: unknown): MutationReport {
  const mutants: MutantRow[] = [];
  const tests = new Map<string, { file: string; line: number; name: string }>();
  if (!isRecord(json)) return { mutants, tests };

  const files = isRecord(json.files) ? json.files : {};
  for (const [path, entry] of Object.entries(files)) {
    if (!isRecord(entry) || !Array.isArray(entry.mutants)) continue;
    for (const raw of entry.mutants) {
      if (!isRecord(raw)) continue;
      const start = isRecord(raw.location) && isRecord(raw.location.start) ? raw.location.start : {};
      const killedBy = Array.isArray(raw.killedBy)
        ? raw.killedBy.filter((id): id is string => typeof id === "string")
        : [];
      mutants.push({
        file: repoPath(path),
        line: asNumber(start.line),
        column: asNumber(start.column),
        mutator: asString(raw.mutatorName),
        replacement: asString(raw.replacement),
        status: asString(raw.status),
        killedBy: [...new Set(killedBy)],
      });
    }
  }

  const testFiles = isRecord(json.testFiles) ? json.testFiles : {};
  for (const [path, entry] of Object.entries(testFiles)) {
    if (!isRecord(entry) || !Array.isArray(entry.tests)) continue;
    for (const raw of entry.tests) {
      if (!isRecord(raw)) continue;
      const id = asString(raw.id);
      if (id === "") continue;
      const start = isRecord(raw.location) && isRecord(raw.location.start) ? raw.location.start : {};
      tests.set(id, { file: repoPath(path), line: asNumber(start.line), name: asString(raw.name) });
    }
  }
  return { mutants, tests };
}

// A mutant counts in a kill set only when Stryker lists a killing test for it: a Survived mutant has none.
function killSets(report: MutationReport): Map<string, Set<string>> {
  const sets = new Map<string, Set<string>>();
  for (const id of report.tests.keys()) sets.set(id, new Set());
  report.mutants.forEach((mutant, index) => {
    if (mutant.status !== "Killed") return;
    for (const testId of mutant.killedBy) sets.get(testId)?.add(String(index));
  });
  return sets;
}

// Repeat "take the test that kills the most not-yet-covered mutants"; ties go to the lower test id.
// Gains only fall, so a stale gain is an upper bound: re-count the best candidate until it stays on top.
export function greedyCover(killSetsByTest: Map<string, Set<string>>): Set<string> {
  const covered = new Set<string>();
  const gains = new Map<string, number>();
  for (const [id, set] of killSetsByTest) gains.set(id, set.size);
  const cover = new Set<string>();
  const ids = [...killSetsByTest.keys()].sort();
  for (;;) {
    let best: string | undefined;
    for (;;) {
      best = undefined;
      for (const id of ids) {
        if (cover.has(id)) continue;
        const gain = gains.get(id) as number;
        if (gain > 0 && (best === undefined || gain > (gains.get(best) as number))) best = id;
      }
      if (best === undefined) return cover;
      let fresh = 0;
      for (const mutant of killSetsByTest.get(best) as Set<string>) if (!covered.has(mutant)) fresh += 1;
      if (fresh === gains.get(best)) break;
      gains.set(best, fresh);
    }
    cover.add(best);
    for (const mutant of killSetsByTest.get(best) as Set<string>) covered.add(mutant);
  }
}

export function caseKills(report: MutationReport): CaseKills[] {
  const sets = killSets(report);
  const cover = greedyCover(sets);
  const unique = new Map<string, number>();
  for (const mutant of report.mutants) {
    if (mutant.status !== "Killed" || mutant.killedBy.length !== 1) continue;
    const only = mutant.killedBy[0] as string;
    unique.set(only, (unique.get(only) ?? 0) + 1);
  }
  return [...report.tests.entries()]
    .map(([testId, info]) => ({
      testId,
      file: info.file,
      line: info.line,
      name: info.name,
      kills: (sets.get(testId) as Set<string>).size,
      uniqueKills: unique.get(testId) ?? 0,
      inCover: cover.has(testId),
    }))
    .sort((a, b) => (a.file === b.file ? a.line - b.line || (a.testId < b.testId ? -1 : 1) : a.file < b.file ? -1 : 1));
}

export interface JunitKeyRow {
  file: string;
  line: number;
  name: string;
  key: string;
}

export const UNJOINED = "unjoined";

// The scan key of a Stryker test (plan F4): the JUnit rows of the same file whose name ends the Stryker name
// (`<file> > <describe> > <test>`; the last part may itself hold " > "), the nearest line wins.
export function joinKey(test: { file: string; line: number; name: string }, rows: JunitKeyRow[]): string {
  // Stryker adds " [n]" to the second and later tests of one file that share a full name (`each` rows).
  const names = [test.name, test.name.replace(/ \[\d+\]$/, "")];
  for (const full of names) {
    let best: JunitKeyRow | undefined;
    for (const row of rows) {
      if (row.file !== test.file) continue;
      if (full !== row.name && !full.endsWith(`${NAME_JOINER}${row.name}`)) continue;
      if (best === undefined || Math.abs(row.line - test.line) < Math.abs(best.line - test.line)) best = row;
    }
    if (best !== undefined) return best.key;
  }
  return UNJOINED;
}

export function parseJunitKeys(text: string): JunitKeyRow[] {
  const [head, ...lines] = text.split("\n").filter((line) => line !== "");
  const names = (head as string).split("\t");
  const at = (name: string): number => names.indexOf(name);
  return lines.map((line) => {
    const cells = line.split("\t");
    return {
      file: cells[at("file")] as string,
      line: Number(cells[at("line")]),
      name: cells[at("name")] as string,
      key: cells[at("key")] as string,
    };
  });
}

const cell = (value: string | number | boolean): string => String(value).replace(/[\t\r\n]+/g, " ");
const table = (header: string[], rows: (string | number | boolean)[][]): string =>
  `${[header.join("\t"), ...rows.map((row) => row.map(cell).join("\t"))].join("\n")}\n`;

export const SURVIVED_STATUSES = ["Survived", "NoCoverage"];

export interface FileScore {
  file: string;
  mutants: number;
  killed: number;
  timeout: number;
  survived: number;
  noCoverage: number;
  errors: number;
  score: number;
}

// Stryker score: (killed + timeout) / (killed + timeout + survived + no coverage); errors and ignored mutants
// stay out of it.
const scoreOf = (killed: number, timeout: number, survived: number, noCoverage: number): number => {
  const valid = killed + timeout + survived + noCoverage;
  return valid === 0 ? 100 : ((killed + timeout) / valid) * 100;
};

export function fileScores(mutants: MutantRow[]): FileScore[] {
  const byFile = new Map<string, FileScore>();
  for (const mutant of mutants) {
    const entry = byFile.get(mutant.file) ?? {
      file: mutant.file,
      mutants: 0,
      killed: 0,
      timeout: 0,
      survived: 0,
      noCoverage: 0,
      errors: 0,
      score: 0,
    };
    entry.mutants += 1;
    if (mutant.status === "Killed") entry.killed += 1;
    else if (mutant.status === "Timeout") entry.timeout += 1;
    else if (mutant.status === "Survived") entry.survived += 1;
    else if (mutant.status === "NoCoverage") entry.noCoverage += 1;
    else entry.errors += 1;
    byFile.set(mutant.file, entry);
  }
  for (const entry of byFile.values()) {
    entry.score = scoreOf(entry.killed, entry.timeout, entry.survived, entry.noCoverage);
  }
  return [...byFile.values()].sort((a, b) => (a.file < b.file ? -1 : 1));
}

export function testsTsv(kills: CaseKills[], rows: JunitKeyRow[]): { tsv: string; unjoined: number } {
  let unjoined = 0;
  const lines = kills.map((item) => {
    const key = joinKey(item, rows);
    if (key === UNJOINED) unjoined += 1;
    const flags = item.kills === 0 ? "S11" : item.uniqueKills === 0 ? "S10" : "";
    return [key, item.file, item.line, item.name, item.kills, item.uniqueKills, item.inCover, flags];
  });
  return {
    tsv: table(["key", "file", "line", "name", "kills", "unique_kills", "in_cover", "flags"], lines),
    unjoined,
  };
}

export function filesTsv(scores: FileScore[]): string {
  return table(
    ["file", "mutants", "killed", "timeout", "survived", "no_coverage", "errors", "score"],
    scores.map((s) => [s.file, s.mutants, s.killed, s.timeout, s.survived, s.noCoverage, s.errors, s.score.toFixed(2)])
  );
}

const byPlace = (a: MutantRow, b: MutantRow): number =>
  a.file === b.file
    ? a.line - b.line || a.column - b.column || (a.mutator < b.mutator ? -1 : 1)
    : a.file < b.file
      ? -1
      : 1;

export function survivedTsv(mutants: MutantRow[]): string {
  return table(
    ["file", "line", "column", "mutator", "replacement"],
    mutants
      .filter((m) => SURVIVED_STATUSES.includes(m.status))
      .sort(byPlace)
      .map((m) => [m.file, m.line, m.column, m.mutator, m.replacement])
  );
}

// `replacement` stays last: two mutants can share (file, line, column, mutator) and differ only there.
export function baselineTsv(mutants: MutantRow[]): string {
  return table(
    ["file", "line", "column", "mutator", "status", "replacement"],
    [...mutants].sort(byPlace).map((m) => [m.file, m.line, m.column, m.mutator, m.status, m.replacement])
  );
}

const SUMMARY_FILES = 15;

export function summaryMd(report: MutationReport, kills: CaseKills[], unjoined: number): string {
  const scores = fileScores(report.mutants);
  const total = scores.reduce(
    (sum, s) => ({
      mutants: sum.mutants + s.mutants,
      killed: sum.killed + s.killed,
      timeout: sum.timeout + s.timeout,
      survived: sum.survived + s.survived,
      noCoverage: sum.noCoverage + s.noCoverage,
      errors: sum.errors + s.errors,
    }),
    { mutants: 0, killed: 0, timeout: 0, survived: 0, noCoverage: 0, errors: 0 }
  );
  const score = scoreOf(total.killed, total.timeout, total.survived, total.noCoverage);
  const zero = kills.filter((k) => k.kills === 0);
  const noUnique = kills.filter((k) => k.kills > 0 && k.uniqueKills === 0);
  const cover = kills.filter((k) => k.inCover).length;
  const worst = [...scores]
    .sort((a, b) => b.survived + b.noCoverage - (a.survived + a.noCoverage) || (a.file < b.file ? -1 : 1))
    .slice(0, SUMMARY_FILES);
  const lines = [
    "# Mutation summary: `packages/core`",
    "",
    `Score **${score.toFixed(2)} %**: ${total.mutants} mutants, ${total.killed} killed, ${total.timeout} timeout, ${total.survived} survived, ${total.noCoverage} no coverage, ${total.errors} error or ignored (outside the score).`,
    "",
    `Stryker tests: ${kills.length}; kill nothing (\`S11\`): ${zero.length}; kill only mutants that another test also kills (\`S10\`): ${noUnique.length}; greedy cover: ${cover}; unjoined to a JUnit case: ${unjoined}.`,
    "",
    `## Cases that kill no mutant (${zero.length})`,
    "",
    ...zero.map((k) => `- \`${k.file}:${k.line}\` ${k.name}`),
    "",
    `## The ${SUMMARY_FILES} files with the most survived and no-coverage mutants`,
    "",
    "| File | Survived | No coverage | Score |",
    "| --- | --- | --- | --- |",
    ...worst.map((s) => `| \`${s.file}\` | ${s.survived} | ${s.noCoverage} | ${s.score.toFixed(2)} % |`),
    "",
  ];
  return lines.join("\n");
}

export interface Difference {
  mutant: string;
  first: string;
  second: string;
}

// Two runs on one commit: mutants compare by (file, line, column, mutator, replacement); a mutant that is in
// one run only is a difference too.
export function compareRuns(
  first: MutantRow[],
  second: MutantRow[]
): { first: number; second: number; differences: Difference[] } {
  const place = (m: MutantRow): string => `${m.file}:${m.line}:${m.column} ${m.mutator} ${m.replacement}`;
  const left = new Map<string, string>();
  const right = new Map<string, string>();
  for (const m of first) left.set(place(m), m.status);
  for (const m of second) right.set(place(m), m.status);
  const differences: Difference[] = [];
  for (const mutant of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const a = left.get(mutant) ?? "absent";
    const b = right.get(mutant) ?? "absent";
    if (a !== b) differences.push({ mutant, first: a, second: b });
  }
  return { first: first.length, second: second.length, differences };
}

function arg(name: string): string {
  const at = process.argv.indexOf(name);
  const value = at === -1 ? undefined : process.argv[at + 1];
  if (value === undefined)
    throw new Error(`usage: mutation-summary.ts --in <mutation.json> --data <dir> (missing ${name})`);
  return value;
}

if (import.meta.main && process.argv.includes("--compare")) {
  const at = process.argv.indexOf("--compare");
  const [one, two] = [process.argv[at + 1], process.argv[at + 2]];
  if (one === undefined || two === undefined) throw new Error("usage: mutation-summary.ts --compare <a.json> <b.json>");
  const result = compareRuns(
    readReport(await Bun.file(one).json()).mutants,
    readReport(await Bun.file(two).json()).mutants
  );
  process.stdout.write(
    `mutants ${result.first} and ${result.second}; status differences ${result.differences.length}\n`
  );
  for (const item of result.differences) process.stdout.write(`${item.mutant}\t${item.first} -> ${item.second}\n`);
} else if (import.meta.main) {
  const report = readReport(await Bun.file(arg("--in")).json());
  const data = arg("--data");
  const rows = parseJunitKeys(await Bun.file(`${data}/junit-cases.tsv`).text());
  const kills = caseKills(report);
  const tests = testsTsv(kills, rows);
  await Bun.write(`${data}/mutation-tests.tsv`, tests.tsv);
  await Bun.write(`${data}/mutation-files.tsv`, filesTsv(fileScores(report.mutants)));
  await Bun.write(`${data}/mutation-survived.tsv`, survivedTsv(report.mutants));
  await Bun.write(`${data}/mutation-baseline.tsv`, baselineTsv(report.mutants));
  await Bun.write(`${data}/mutation-summary.md`, summaryMd(report, kills, tests.unjoined));
  process.stdout.write(
    `mutants ${report.mutants.length}, tests ${kills.length}, unjoined ${tests.unjoined} (${((tests.unjoined / Math.max(kills.length, 1)) * 100).toFixed(2)} %)\n`
  );
}
