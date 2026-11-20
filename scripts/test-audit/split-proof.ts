// Proof of a split stage: the parts run the same cases as the old file. Cases compare as a multiset keyed by
// classname, name and skipped state (not by file or line); a changed assertion count is listed, not failed.
// Usage: bun scripts/test-audit/split-proof.ts --before <xml> --after <xml> [--after <xml> …]
// Each part runs in its own process and writes its own XML; the cases of all --after files form one multiset.
// Exit 0 when the cases match, 1 when a case is missing or extra (or a side has none), 2 on a bad argument or
// an unreadable file.
import { parseJunit, type JunitCase } from "./junit";

export interface SplitProof {
  pass: boolean;
  lines: string[];
}

const keyOf = (item: JunitCase): string => `${item.classname} :: ${item.name}${item.skipped ? " [skipped]" : ""}`;

function group(cases: JunitCase[]): Map<string, JunitCase[]> {
  const map = new Map<string, JunitCase[]>();
  for (const item of cases) {
    const key = keyOf(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

const sortedKeys = (maps: Map<string, unknown>[]): string[] =>
  [...new Set(maps.flatMap((map) => [...map.keys()]))].sort();

export function splitProof(before: JunitCase[], after: JunitCase[]): SplitProof {
  if (before.length === 0 || after.length === 0) return { pass: false, lines: ["split-proof FAIL no cases"] };
  const was = group(before);
  const now = group(after);
  const keys = sortedKeys([was, now]);
  const count = (map: Map<string, JunitCase[]>, key: string): number => map.get(key)?.length ?? 0;

  const missing = keys.filter((key) => count(was, key) > count(now, key));
  const extra = keys.filter((key) => count(now, key) > count(was, key));
  const assertions = keys.flatMap((key) => {
    const [old, next] = [was.get(key), now.get(key)];
    if (old?.length !== 1 || next?.length !== 1) return [];
    const [a, b] = [(old[0] as JunitCase).assertions, (next[0] as JunitCase).assertions];
    return a === b ? [] : [`assertions ${key} ${a} ${b}`];
  });
  const total = (list: string[], from: Map<string, JunitCase[]>, other: Map<string, JunitCase[]>): number =>
    list.reduce((sum, key) => sum + count(from, key) - count(other, key), 0);
  const missingCount = total(missing, was, now);
  const extraCount = total(extra, now, was);

  const pass = missingCount === 0 && extraCount === 0;
  const verdict = pass
    ? `split-proof PASS cases=${after.length}`
    : `split-proof FAIL missing=${missingCount} extra=${extraCount}`;
  return {
    pass,
    lines: [...missing.map((key) => `missing ${key}`), ...extra.map((key) => `extra ${key}`), ...assertions, verdict],
  };
}

function readArgs(argv: string[]): { before: string; after: string[] } {
  const before: string[] = [];
  const after: string[] = [];
  for (let at = 0; at < argv.length; at += 2) {
    const [flag, value] = [argv[at], argv[at + 1]];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    if (flag === "--before") before.push(value);
    else if (flag === "--after") after.push(value);
    else throw new Error(`unknown argument ${flag}`);
  }
  if (before.length !== 1 || after.length === 0) {
    throw new Error("usage: split-proof.ts --before <xml> --after <xml> [--after <xml> …]");
  }
  return { before: before[0] as string, after };
}

async function readCases(path: string): Promise<JunitCase[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`cannot read ${path}`);
  return parseJunit(await file.text());
}

if (import.meta.main) {
  try {
    const args = readArgs(process.argv.slice(2));
    const before = await readCases(args.before);
    const after = (await Promise.all(args.after.map(readCases))).flat();
    const result = splitProof(before, after);
    process.stdout.write(`${result.lines.join("\n")}\n`);
    process.exit(result.pass ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}
