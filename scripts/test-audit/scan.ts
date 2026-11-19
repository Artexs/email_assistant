// Static scan of test cases: pure functions from source text to case rows (audit tool of the test-audit ticket).
import ts from "typescript";
import { importSpecifiers, isAllowedImport } from "./scan-imports";

export type CaseKind = "unit" | "int" | "e2e";

export interface CaseRow {
  key: string;
  file: string;
  line: number;
  kind: CaseKind;
  describePath: string;
  name: string;
  each: boolean;
  expectCalls: number;
  matchers: string[];
  flags: string[];
  bodyGroup: string;
  shapeGroup: string;
  skipCondition: string;
  bodyLines: number;
  shared: boolean;
}

export interface BodyText {
  body: string;
  shape: string;
}

export interface ScanResult {
  rows: CaseRow[];
  bodies: Map<string, BodyText>;
}

export type AssertingResolver = (call: ts.CallExpression) => boolean;

const WEAK_MATCHERS = new Set([
  "toBeDefined",
  "toBeTruthy",
  "toBeFalsy",
  "not.toBeNull",
  "not.toBeUndefined",
  "not.toThrow",
  "toHaveBeenCalled",
]);
const CASE_MODS = new Set([
  "each",
  "skip",
  "only",
  "todo",
  "if",
  "skipIf",
  "runIf",
  "concurrent",
  "serial",
  "fixme",
  "fail",
  "failing",
]);
const DESCRIBE_MODS = new Set([...CASE_MODS, "parallel", "configure"]);
const CONDITION_MODS = new Set(["if", "skipIf", "runIf"]);
const MARK_MODS = new Set(["skip", "only", "todo", "fixme"]);
const LOOP_CALLS = new Set(["forEach", "map", "flatMap"]);
const TEST_FILE = /\.(test|spec)\.tsx?$/;
const INT_PREFIXES = ["apps/server/test/", "tools/fake-telegram/test/"];
const E2E_PREFIXES = ["apps/web/e2e/", "apps/docs/e2e/"];

export function isTestFile(file: string): boolean {
  return TEST_FILE.test(file);
}

export function kindOf(file: string): CaseKind {
  if (E2E_PREFIXES.some((prefix) => file.startsWith(prefix))) return "e2e";
  if (INT_PREFIXES.some((prefix) => file.startsWith(prefix))) return "int";
  return "unit";
}

// --- call classification ---------------------------------------------------

interface Mod {
  name: string;
  args: readonly ts.Expression[];
}
interface Chain {
  root: string;
  mods: Mod[];
}

function parseChain(expr: ts.Expression): Chain | undefined {
  if (ts.isIdentifier(expr)) return { root: expr.text, mods: [] };
  if (ts.isPropertyAccessExpression(expr)) {
    const inner = parseChain(expr.expression);
    if (!inner) return undefined;
    inner.mods.push({ name: expr.name.text, args: [] });
    return inner;
  }
  if (ts.isCallExpression(expr)) {
    const inner = parseChain(expr.expression);
    const last = inner?.mods[inner.mods.length - 1];
    if (!inner || !last) return undefined;
    last.args = expr.arguments;
    return inner;
  }
  return undefined;
}

function titleText(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText().slice(1, -1);
  return undefined;
}

export function isFunctionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

interface Call {
  type: "case" | "describe";
  mods: Mod[];
  title: string;
  callback: ts.ArrowFunction | ts.FunctionExpression | undefined;
}

function classify(node: ts.CallExpression): Call | undefined {
  const chain = parseChain(node.expression);
  if (!chain) return undefined;
  const title = titleText(node.arguments[0]);
  if (title === undefined) return undefined;
  const callback = node.arguments.slice(1).find(isFunctionLike);
  const { root } = chain;
  let { mods } = chain;
  let type: Call["type"];
  if (root === "describe") {
    type = "describe";
  } else if ((root === "test" || root === "it") && mods[0]?.name === "describe") {
    type = "describe";
    mods = mods.slice(1);
  } else if (root === "test" || root === "it") {
    type = "case";
  } else {
    return undefined;
  }
  const allowed = type === "describe" ? DESCRIBE_MODS : CASE_MODS;
  if (!mods.every((mod) => allowed.has(mod.name))) return undefined;
  if (type === "case" && !callback && node.arguments.length < 2 && !mods.some((mod) => mod.name === "todo")) {
    return undefined;
  }
  if (type === "describe" && !callback) return undefined;
  return { type, mods, title, callback };
}

function skipParts(mods: Mod[]): string[] {
  const parts: string[] = [];
  for (const mod of mods) {
    if (CONDITION_MODS.has(mod.name)) {
      const condition = mod.args[0];
      parts.push(condition ? collapse(condition.getText()) : mod.name);
    } else if (MARK_MODS.has(mod.name)) {
      parts.push(mod.name === "fixme" ? "fixme" : mod.name);
    }
  }
  return parts;
}

// --- expect analysis -------------------------------------------------------

export function isExpectCall(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text === "expect";
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "expect"
  ) {
    return ["soft", "poll", "assertions", "hasAssertions"].includes(callee.name.text);
  }
  return false;
}

function matcherOf(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    if (callee.name.text === "assertions" || callee.name.text === "hasAssertions") return undefined;
  }
  const names: string[] = [];
  let node: ts.Node = call;
  while (ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) {
    names.push(node.parent.name.text);
    node = node.parent;
  }
  return names.length > 0 ? names.join(".") : undefined;
}

interface BodyStats {
  expectCalls: number;
  helperCalls: number;
  matchers: string[];
}

function analyseBody(body: ts.Node, resolveAsserting: AssertingResolver): BodyStats {
  const stats: BodyStats = { expectCalls: 0, helperCalls: 0, matchers: [] };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (isExpectCall(node)) {
        stats.expectCalls += 1;
        const matcher = matcherOf(node);
        if (matcher) stats.matchers.push(matcher);
      } else if (resolveAsserting(node)) {
        stats.expectCalls += 1;
        stats.helperCalls += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return stats;
}

function lastSegment(matcher: string): string {
  return matcher.slice(matcher.lastIndexOf(".") + 1);
}

function isMockMatcher(matcher: string): boolean {
  return /^(not\.)?toHaveBeen(Last|Nth)?Called/.test(matcher);
}

// --- body text -------------------------------------------------------------

const printer = ts.createPrinter({ removeComments: true });

function printBody(body: ts.Node, sf: ts.SourceFile): string {
  return collapse(printer.printNode(ts.EmitHint.Unspecified, body, sf));
}

function printShape(body: ts.Node, sf: ts.SourceFile): string {
  const result = ts.transform(body, [
    (context) => (root) => {
      const visit = (node: ts.Node): ts.Node => {
        if (ts.isTaggedTemplateExpression(node)) {
          const tag = ts.visitNode(node.tag, visit) as ts.Expression;
          return context.factory.createTaggedTemplateExpression(
            tag,
            undefined,
            context.factory.createNoSubstitutionTemplateLiteral("_")
          );
        }
        if (
          ts.isStringLiteral(node) ||
          ts.isNumericLiteral(node) ||
          ts.isBigIntLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateExpression(node) ||
          ts.isRegularExpressionLiteral(node)
        ) {
          return context.factory.createIdentifier("_");
        }
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitNode(root, visit) as ts.Node;
    },
  ]);
  const text = printer.printNode(ts.EmitHint.Unspecified, result.transformed[0] as ts.Node, sf);
  result.dispose();
  return collapse(text);
}

// --- scan ------------------------------------------------------------------

interface Context {
  describes: { title: string; skip: string[] }[];
  loop: boolean;
  each: boolean;
}

export function scanFile(file: string, text: string, resolveAsserting: AssertingResolver): ScanResult {
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, scriptKind);
  const shared = !isTestFile(file);
  const imports = importSpecifiers(sf);
  const result: ScanResult = { rows: [], bodies: new Map() };
  if (shared) {
    const bunNames = imports.boundNames.get("bun:test");
    if (!bunNames || !(bunNames.has("test") || bunNames.has("it"))) return result;
  }
  const kind = kindOf(file);
  const noProdImport = kind !== "e2e" && imports.runtime.every((spec) => isAllowedImport(file, spec));

  const addCase = (node: ts.CallExpression, call: Call, context: Context): void => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const key = `${file}:${line}`;
    const callback = call.callback;
    const stats = callback
      ? analyseBody(callback.body, resolveAsserting)
      : { expectCalls: 0, helperCalls: 0, matchers: [] };
    const skip = [...context.describes.flatMap((entry) => entry.skip), ...skipParts(call.mods)];
    const flags: string[] = [];
    if (stats.expectCalls === 0) flags.push("S1");
    const directOnly = stats.helperCalls === 0 && stats.matchers.length > 0;
    if (directOnly && stats.matchers.every((matcher) => WEAK_MATCHERS.has(matcher))) flags.push("S2");
    if (directOnly && stats.matchers.every(isMockMatcher)) flags.push("S3");
    if (stats.matchers.some((matcher) => /^toMatch(Inline)?Snapshot$/.test(lastSegment(matcher)))) flags.push("S4");
    if (skip.length > 0) flags.push("S7");
    if (noProdImport) flags.push("S8");
    const bodyLines = callback
      ? sf.getLineAndCharacterOfPosition(callback.body.end).line -
        sf.getLineAndCharacterOfPosition(callback.body.getStart(sf)).line +
        1
      : 0;
    result.rows.push({
      key,
      file,
      line,
      kind,
      describePath: context.describes.map((entry) => entry.title).join(" > "),
      name: call.title,
      each: context.each || context.loop || call.mods.some((mod) => mod.name === "each"),
      expectCalls: stats.expectCalls,
      matchers: stats.matchers,
      flags,
      bodyGroup: "",
      shapeGroup: "",
      skipCondition: skip.join(" ; "),
      bodyLines,
      shared,
    });
    if (callback) {
      result.bodies.set(key, { body: printBody(callback.body, sf), shape: printShape(callback.body, sf) });
    }
  };

  const visit = (node: ts.Node, context: Context): void => {
    if (ts.isCallExpression(node)) {
      const call = classify(node);
      if (call?.type === "case") {
        addCase(node, call, context);
        return;
      }
      if (call?.type === "describe" && call.callback) {
        const inner: Context = {
          describes: [...context.describes, { title: call.title, skip: skipParts(call.mods) }],
          loop: context.loop,
          each: context.each || call.mods.some((mod) => mod.name === "each"),
        };
        visit(call.callback.body, inner);
        return;
      }
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee) && LOOP_CALLS.has(callee.name.text)) {
        ts.forEachChild(node, (child) => visit(child, { ...context, loop: true }));
        return;
      }
    }
    if (ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isForStatement(node)) {
      ts.forEachChild(node, (child) => visit(child, { ...context, loop: true }));
      return;
    }
    ts.forEachChild(node, (child) => visit(child, context));
  };
  visit(sf, { describes: [], loop: false, each: false });
  return result;
}

export function scanSource(file: string, text: string, resolveAsserting: AssertingResolver): CaseRow[] {
  return scanFile(file, text, resolveAsserting).rows;
}

// --- groups ----------------------------------------------------------------

function compareKeys(a: CaseRow, b: CaseRow): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.line - b.line;
}

function addFlag(row: CaseRow, flag: string): void {
  if (!row.flags.includes(flag)) row.flags = [...row.flags, flag].sort();
}

function numberGroups(prefix: string, groups: CaseRow[][]): void {
  const ordered = groups
    .map((rows) => [...rows].sort(compareKeys))
    .sort((a, b) => compareKeys(a[0] as CaseRow, b[0] as CaseRow));
  ordered.forEach((rows, index) => {
    for (const row of rows) {
      if (prefix === "B") {
        row.bodyGroup = `B${index + 1}`;
        addFlag(row, "S5");
      } else {
        row.shapeGroup = `T${index + 1}`;
        addFlag(row, "S6");
      }
    }
  });
}

function bucket(rows: CaseRow[], keyOf: (row: CaseRow) => string | undefined): CaseRow[][] {
  const map = new Map<string, CaseRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === undefined) continue;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.values()];
}

export function assignGroups(rows: CaseRow[], bodies: Map<string, BodyText>): void {
  const bodyGroups = bucket(rows, (row) => bodies.get(row.key)?.body).filter((group) => group.length >= 2);
  numberGroups("B", bodyGroups);
  const shapeGroups = bucket(rows, (row) => {
    const shape = bodies.get(row.key)?.shape;
    return row.each || shape === undefined ? undefined : `${row.file}\u0000${shape}`;
  }).filter((group) => group.length >= 3);
  numberGroups("T", shapeGroups);
}
