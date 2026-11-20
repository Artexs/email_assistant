// Per-function view of a Stryker mutation run of packages/core: which functions hold the survived and
// no-coverage mutants, a before/after table of two runs, and the new test cases that kill a before-survivor.
// Usage: bun scripts/test-audit/mutation-gaps.ts --in <mutation.json> [--min <n>] [--by fn]
//        bun scripts/test-audit/mutation-gaps.ts --before <mutation.json> --after <mutation.json> [--min <n>]
import ts from "typescript";
import { readReport, repoPath, SURVIVED_STATUSES, type MutantRow } from "./mutation-summary";

export const MODULE_LEVEL = "(module level)";
const DEFAULT_MIN = 5;

export interface FunctionName {
  fn: string;
  id: string;
}

interface Located extends FunctionName {
  startLine: number;
}

// A function counts as named when it is a declaration, a method, or an arrow or function expression whose
// parent (through parentheses and type assertions) is a variable or a property. An anonymous callback passes up.
const isWrapper = (node: ts.Node): boolean =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isTypeAssertionExpression(node);

const nameText = (name: ts.Node | undefined): string | undefined =>
  name !== undefined &&
  (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name))
    ? name.text
    : undefined;

// The name a node gives to the chain, or undefined. A variable or property names the function it holds.
function ownName(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isPropertyDeclaration(node)
  ) {
    return nameText(node.name);
  }
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isShorthandPropertyAssignment(node)) return node.name.text;
  return undefined;
}

// The declaration that names an arrow or function expression: its variable or property, or undefined.
function holder(node: ts.Node): ts.Node | undefined {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return undefined;
  let parent = node.parent;
  while (isWrapper(parent)) parent = parent.parent;
  const named =
    (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) &&
    ownName(parent) !== undefined;
  return named ? parent : undefined;
}

// The node of a function that carries its name, or undefined when the function is anonymous.
function namedFunction(node: ts.Node): ts.Node | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  ) {
    return ownName(node) === undefined ? undefined : node;
  }
  return holder(node);
}

function chainOf(named: ts.Node): string[] {
  const chain: string[] = [];
  for (let node: ts.Node | undefined = named; node !== undefined && !ts.isSourceFile(node); node = node.parent) {
    const name = ownName(node);
    if (name !== undefined) chain.unshift(name);
  }
  return chain;
}

const parse = (source: string): ts.SourceFile =>
  ts.createSourceFile("mutated.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function offsetOf(file: ts.SourceFile, line: number, column: number): number {
  const lines = file.getLineStarts();
  const start = lines[line - 1] ?? file.getEnd();
  return Math.min(start + column - 1, file.getEnd());
}

function innermost(file: ts.SourceFile, offset: number): ts.Node[] {
  const path: ts.Node[] = [file];
  let node: ts.Node = file;
  for (;;) {
    const child = node.getChildren(file).find((c) => c.getStart(file) <= offset && offset < c.getEnd());
    if (child === undefined) return path;
    path.push(child);
    node = child;
  }
}

function locate(file: ts.SourceFile, line: number, column: number): Located {
  const path = innermost(file, offsetOf(file, line, column));
  for (let at = path.length - 1; at >= 0; at -= 1) {
    const node = path[at] as ts.Node;
    const named = namedFunction(node);
    if (named === undefined) continue;
    const chain = chainOf(named);
    return {
      fn: chain[chain.length - 1] as string,
      id: chain.join("."),
      startLine: file.getLineAndCharacterOfPosition(named.getStart(file)).line + 1,
    };
  }
  return { fn: MODULE_LEVEL, id: MODULE_LEVEL, startLine: 0 };
}

// Mutant position: line and column are 1-based, as in the Stryker report.
export function functionOf(source: string, line: number, column: number): FunctionName {
  const { fn, id } = locate(parse(source), line, column);
  return { fn, id };
}

// Every named function of a source, in source order; the row ids of one file derive from this list.
function namedFunctions(file: ts.SourceFile): Located[] {
  const found: Located[] = [];
  const visit = (node: ts.Node): void => {
    const named = namedFunction(node);
    if (named !== undefined) {
      const chain = chainOf(named);
      found.push({
        fn: chain[chain.length - 1] as string,
        id: chain.join("."),
        startLine: file.getLineAndCharacterOfPosition(named.getStart(file)).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

// The row id: the short name when it is unique in the file, else the dotted chain, plus the start line when the
// chain still repeats.
function rowIds(file: ts.SourceFile): (item: Located) => string {
  const all = namedFunctions(file);
  const count = (key: (f: Located) => string, value: string): number => all.filter((f) => key(f) === value).length;
  return (item) => {
    if (item.fn === MODULE_LEVEL) return MODULE_LEVEL;
    if (count((f) => f.fn, item.fn) <= 1) return item.fn;
    if (count((f) => f.id, item.id) <= 1) return item.id;
    return `${item.id}@${item.startLine}`;
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function sourcesOf(json: unknown): Map<string, string> {
  const sources = new Map<string, string>();
  const files = isRecord(json) && isRecord(json.files) ? json.files : {};
  for (const [path, entry] of Object.entries(files)) {
    if (isRecord(entry) && typeof entry.source === "string") sources.set(repoPath(path), entry.source);
  }
  return sources;
}

export interface GapRow {
  file: string;
  fn: string;
  id: string;
  survived: number;
  noCoverage: number;
}

const total = (row: { survived: number; noCoverage: number }): number => row.survived + row.noCoverage;
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Counted statuses are Survived and NoCoverage; no other. `by` "fn" groups the functions of a file by short name.
export function functionGaps(json: unknown, by: "id" | "fn" = "id"): GapRow[] {
  const sources = sourcesOf(json);
  const counted = new Map<string, MutantRow[]>();
  for (const mutant of readReport(json).mutants) {
    if (!SURVIVED_STATUSES.includes(mutant.status)) continue;
    counted.set(mutant.file, [...(counted.get(mutant.file) ?? []), mutant]);
  }
  const rows = new Map<string, GapRow>();
  for (const [path, mutants] of counted) {
    const source = sources.get(path);
    if (source === undefined) throw new Error(`mutation report has no source for ${path}`);
    const file = parse(source);
    const idOf = rowIds(file);
    for (const mutant of mutants) {
      const found = locate(file, mutant.line, mutant.column);
      const id = by === "fn" ? found.fn : idOf(found);
      const key = `${path}\t${id}`;
      const row = rows.get(key) ?? { file: path, fn: found.fn, id, survived: 0, noCoverage: 0 };
      if (mutant.status === "Survived") row.survived += 1;
      else row.noCoverage += 1;
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort(
    (a, b) => total(b) - total(a) || compareText(a.file, b.file) || compareText(a.id, b.id)
  );
}

export interface CompareRow {
  file: string;
  id: string;
  before: number;
  after: number;
}

// A function missing from one side has 0 counted mutants there.
export function compareGaps(before: unknown, after: unknown): CompareRow[] {
  const rows = new Map<string, CompareRow>();
  const add = (gaps: GapRow[], side: "before" | "after"): void => {
    for (const gap of gaps) {
      const key = `${gap.file}\t${gap.id}`;
      const row = rows.get(key) ?? { file: gap.file, id: gap.id, before: 0, after: 0 };
      row[side] = total(gap);
      rows.set(key, row);
    }
  };
  add(functionGaps(before), "before");
  add(functionGaps(after), "after");
  return [...rows.values()].sort(
    (a, b) => b.before - a.before || b.after - a.after || compareText(a.file, b.file) || compareText(a.id, b.id)
  );
}

export interface NewCaseKills {
  file: string;
  name: string;
  kills: number;
}

const mutantKey = (m: MutantRow): string => `${m.file}:${m.line}:${m.column}\t${m.mutator}\t${m.replacement}`;
const caseKey = (file: string, name: string): string => `${file}\t${name}`;

// A case is new when its (file, name) is in `after` only. It kills a mutant that was Survived or NoCoverage
// before, is Killed after, and lists the case in `killedBy`.
export function newCaseKills(before: unknown, after: unknown): NewCaseKills[] {
  const old = readReport(before);
  const next = readReport(after);
  const known = new Set([...old.tests.values()].map((t) => caseKey(t.file, t.name)));
  const wasCounted = new Set(old.mutants.filter((m) => SURVIVED_STATUSES.includes(m.status)).map(mutantKey));
  const kills = new Map<string, NewCaseKills>();
  for (const test of next.tests.values()) {
    const key = caseKey(test.file, test.name);
    if (!known.has(key)) kills.set(key, { file: test.file, name: test.name, kills: 0 });
  }
  for (const mutant of next.mutants) {
    if (mutant.status !== "Killed" || !wasCounted.has(mutantKey(mutant))) continue;
    const credited = new Set<string>();
    for (const id of mutant.killedBy) {
      const test = next.tests.get(id);
      const key = test === undefined ? undefined : caseKey(test.file, test.name);
      if (key !== undefined && kills.has(key)) credited.add(key);
    }
    for (const key of credited) (kills.get(key) as NewCaseKills).kills += 1;
  }
  return [...kills.values()].sort((a, b) => compareText(a.file, b.file) || compareText(a.name, b.name));
}

const cell = (value: string | number): string => String(value).replace(/[\t\r\n|]+/g, " ");

export function gapsTsv(rows: GapRow[], min: number): string {
  const lines = rows
    .filter((row) => total(row) >= min)
    .map((row) => [row.file, row.id, row.survived, row.noCoverage, total(row)].map(cell).join("\t"));
  return `${["file\tid\tsurvived\tno_coverage\ttotal", ...lines].join("\n")}\n`;
}

const mdTable = (header: string[], rows: (string | number)[][]): string =>
  [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");

export function compareMarkdown(rows: CompareRow[], cases: NewCaseKills[]): string {
  const dead = cases.filter((c) => c.kills === 0);
  return `${[
    mdTable(
      ["file", "function", "before", "after"],
      rows.map((r) => [r.file, r.id, r.before, r.after])
    ),
    "",
    mdTable(
      ["test file", "case", "kills"],
      cases.map((c) => [c.file, c.name, c.kills])
    ),
    "",
    `${dead.length} new ${dead.length === 1 ? "case kills" : "cases kill"} no before-survivor`,
  ].join("\n")}\n`;
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

const USAGE =
  "usage: mutation-gaps.ts --in <mutation.json> [--min <n>] [--by fn] | --before <mutation.json> --after <mutation.json> [--min <n>]";

export async function runCli(args: string[]): Promise<{ out: string; code: number }> {
  const minText = option(args, "--min");
  const min = minText === undefined ? undefined : Number(minText);
  if (min !== undefined && !Number.isInteger(min)) throw new Error(`${USAGE} (--min needs a whole number)`);
  const input = option(args, "--in");
  const beforePath = option(args, "--before");
  const afterPath = option(args, "--after");
  if (input !== undefined) {
    const by = option(args, "--by");
    if (by !== undefined && by !== "fn") throw new Error(`${USAGE} (--by takes fn)`);
    const json = await Bun.file(input).json();
    return { out: gapsTsv(functionGaps(json, by === "fn" ? "fn" : "id"), min ?? DEFAULT_MIN), code: 0 };
  }
  if (beforePath === undefined || afterPath === undefined) throw new Error(USAGE);
  const before: unknown = await Bun.file(beforePath).json();
  const after: unknown = await Bun.file(afterPath).json();
  const shown = compareGaps(before, after).filter((row) => Math.max(row.before, row.after) >= (min ?? 1));
  const cases = newCaseKills(before, after);
  return { out: compareMarkdown(shown, cases), code: cases.some((c) => c.kills === 0) ? 1 : 0 };
}

if (import.meta.main) {
  const result = await runCli(process.argv.slice(2));
  process.stdout.write(result.out);
  process.exitCode = result.code;
}
