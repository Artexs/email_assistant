// Usage: bun scripts/test-audit/coverage-cli.ts --run1 <dir> --run2 <dir> --data <audit data dir>
// A run dir holds unit/lcov.info and int/lcov.info (coverage.sh). Writes into <data>:
//   coverage-baseline.tsv: file, unit_found, unit_hit, int_found, int_hit, union_hit (from run 1)
//   coverage-noise.tsv:    one row per source file whose union hit lines differ between the two runs
// An int report that is missing gives `-` in the int columns; the union then holds the unit lines only.
import { parseLcov, unionHits, type FileCoverage } from "./lcov";

function arg(name: string): string {
  const at = process.argv.indexOf(name);
  const value = at === -1 ? undefined : process.argv[at + 1];
  if (value === undefined)
    throw new Error(`usage: coverage-cli.ts --run1 <dir> --run2 <dir> --data <dir> (missing ${name})`);
  return value;
}

type Report = Map<string, FileCoverage>;

async function readReport(path: string): Promise<Report | null> {
  const file = Bun.file(path);
  return (await file.exists()) ? parseLcov(await file.text()) : null;
}

async function readRun(dir: string): Promise<{ unit: Report | null; int: Report | null }> {
  return { unit: await readReport(`${dir}/unit/lcov.info`), int: await readReport(`${dir}/int/lcov.info`) };
}

const union = (run: { unit: Report | null; int: Report | null }): Report =>
  unionHits(run.unit ?? new Map(), run.int ?? new Map());

const data = arg("--data");
const run1 = await readRun(arg("--run1"));
const run2 = await readRun(arg("--run2"));
if (run1.unit === null) throw new Error("run 1 has no unit/lcov.info");

const both = union(run1);
const header = ["file", "unit_found", "unit_hit", "int_found", "int_hit", "union_hit"];
const lines = [...both.keys()].sort().map((file) => {
  const unit = run1.unit?.get(file);
  const int = run1.int?.get(file);
  const intCells = run1.int === null ? ["-", "-"] : [int?.found ?? 0, int?.hit ?? 0];
  return [file, unit?.found ?? 0, unit?.hit ?? 0, ...intCells, both.get(file)?.hit ?? 0].join("\t");
});
await Bun.write(`${data}/coverage-baseline.tsv`, `${[header.join("\t"), ...lines].join("\n")}\n`);

const second = union(run2);
const noise: string[] = [];
for (const file of [...new Set([...both.keys(), ...second.keys()])].sort()) {
  const a = both.get(file)?.hitLines ?? new Set<number>();
  const b = second.get(file)?.hitLines ?? new Set<number>();
  const differing = [...a].filter((line) => !b.has(line)).length + [...b].filter((line) => !a.has(line)).length;
  if (differing > 0) noise.push([file, differing].join("\t"));
}
await Bun.write(`${data}/coverage-noise.tsv`, `${["file\tdiffering_lines", ...noise].join("\n")}\n`);
process.stdout.write(`baseline ${lines.length} files, noise ${noise.length} files\n`);
