// Lane split of the cut run: each test file goes to the unit lane or the int lane by the paths of
// `test:unit` and `test:int` in package.json (the same paths as run-suites.sh and coverage.sh).
// Usage: bun scripts/test-audit/cut-run.ts <test file>…   prints `unit <files>` and `int <files>` (space-joined);
// exits 2 with the path of a file that is in neither lane.
import { suitePaths } from "./junit";

export interface Lanes {
  unit: string[];
  int: string[];
  unknown: string[];
}

const normalize = (path: string): string => path.replace(/^(\.\/)+/, "");

const inLane = (file: string, paths: string[]): boolean =>
  paths.some((path) => {
    const root = normalize(path).replace(/\/+$/, "");
    return file === root || file.startsWith(`${root}/`);
  });

export function splitLanes(files: string[], unitPaths: string[], intPaths: string[]): Lanes {
  const lanes: Lanes = { unit: [], int: [], unknown: [] };
  for (const raw of files) {
    const file = normalize(raw);
    if (inLane(file, intPaths)) lanes.int.push(file);
    else if (inLane(file, unitPaths)) lanes.unit.push(file);
    else lanes.unknown.push(file);
  }
  return lanes;
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error("usage: cut-run.ts <test file>…");
  const scripts = ((await Bun.file("package.json").json()) as { scripts: Record<string, string> }).scripts;
  const lanes = splitLanes(files, suitePaths(scripts["test:unit"] ?? ""), suitePaths(scripts["test:int"] ?? ""));
  if (lanes.unknown.length > 0) {
    process.stderr.write(`cut-run: not in the unit or the int lane: ${lanes.unknown.join(" ")}\n`);
    process.exit(2);
  }
  process.stdout.write(`unit ${lanes.unit.join(" ")}\nint ${lanes.int.join(" ")}\n`);
}
