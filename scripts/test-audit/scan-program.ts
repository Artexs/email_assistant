// Program-based helper resolution for the scan: which called functions hold an expect call.
import * as path from "node:path";
import ts from "typescript";
import { isExpectCall, isFunctionLike, type AssertingResolver } from "./scan";

const MAX_HELPER_DEPTH = 3;

function findCall(sf: ts.SourceFile, pos: number, end: number): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found || node.pos > pos || node.end < end) return;
    if (ts.isCallExpression(node) && node.pos === pos && node.end === end) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function bodyOf(declaration: ts.Declaration): ts.Node | undefined {
  if (ts.isFunctionDeclaration(declaration) || ts.isMethodDeclaration(declaration)) return declaration.body;
  if (ts.isVariableDeclaration(declaration) && declaration.initializer && isFunctionLike(declaration.initializer)) {
    return declaration.initializer.body;
  }
  if (ts.isPropertyAssignment(declaration) && isFunctionLike(declaration.initializer))
    return declaration.initializer.body;
  if (isFunctionLike(declaration)) return declaration.body;
  return undefined;
}

// A call is "asserting" when its callee body holds an expect call, up to 3 calls deep.
export function createAssertingResolver(program: ts.Program): AssertingResolver {
  const checker = program.getTypeChecker();
  const memo = new Map<ts.Node, boolean>();

  const declarationsOf = (call: ts.CallExpression): ts.Declaration[] => {
    const callee = call.expression;
    const target = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
    let symbol = checker.getSymbolAtLocation(target);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.declarations ?? [];
  };

  const holdsExpect = (call: ts.CallExpression, depth: number): boolean => {
    if (isExpectCall(call)) return false;
    for (const declaration of declarationsOf(call)) {
      if (declaration.getSourceFile().fileName.includes("/node_modules/")) continue;
      const body = bodyOf(declaration);
      if (!body) continue;
      const cached = memo.get(body);
      if (cached !== undefined && depth === MAX_HELPER_DEPTH) {
        if (cached) return true;
        continue;
      }
      let hit = false;
      const visit = (node: ts.Node): void => {
        if (hit) return;
        if (ts.isCallExpression(node)) {
          if (isExpectCall(node)) {
            hit = true;
            return;
          }
          if (depth > 1 && holdsExpect(node, depth - 1)) {
            hit = true;
            return;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(body);
      if (depth === MAX_HELPER_DEPTH) memo.set(body, hit);
      if (hit) return true;
    }
    return false;
  };

  return (call) => {
    const sf = program.getSourceFile(call.getSourceFile().fileName);
    if (!sf) return false;
    const local = sf === call.getSourceFile() ? call : findCall(sf, call.pos, call.end);
    return local ? holdsExpect(local, MAX_HELPER_DEPTH) : false;
  };
}

export function createScanProgram(
  rootNames: string[],
  options: ts.CompilerOptions,
  host?: ts.CompilerHost
): ts.Program {
  return ts.createProgram({ rootNames, options, host });
}

export function readBaseOptions(repoRoot: string): ts.CompilerOptions {
  const configPath = path.join(repoRoot, "tsconfig.base.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, repoRoot);
  return { ...parsed.options, noEmit: true, jsx: ts.JsxEmit.ReactJSX };
}
