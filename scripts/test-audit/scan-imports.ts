// Import analysis for the no-prod-import flag.
import * as path from "node:path";
import ts from "typescript";

const SUPPORT_PREFIXES = ["apps/server/test/", "apps/web/e2e/", "tools/"];

export function importSpecifiers(sf: ts.SourceFile): { runtime: string[]; boundNames: Map<string, Set<string>> } {
  const runtime: string[] = [];
  const boundNames = new Map<string, Set<string>>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const clause = node.importClause;
      const typeOnly = clause?.isTypeOnly === true;
      const named = clause?.namedBindings;
      const allSpecifiersTypeOnly =
        !!named &&
        ts.isNamedImports(named) &&
        !clause?.name &&
        named.elements.length > 0 &&
        named.elements.every((element) => element.isTypeOnly);
      if (!typeOnly && !allSpecifiersTypeOnly) runtime.push(spec);
      if (named && ts.isNamedImports(named)) {
        const names = boundNames.get(spec) ?? new Set<string>();
        for (const element of named.elements) names.add((element.propertyName ?? element.name).text);
        boundNames.set(spec, names);
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.isTypeOnly) runtime.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      runtime.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { runtime, boundNames };
}

export function isAllowedImport(file: string, spec: string): boolean {
  if (spec === "bun:test" || spec === "@playwright/test" || spec.startsWith("node:")) return true;
  if (!spec.startsWith(".")) return false;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
  if (SUPPORT_PREFIXES.some((prefix) => resolved.startsWith(prefix))) return true;
  const segments = resolved.split("/");
  if (segments.includes("fake")) return true;
  const base = (segments[segments.length - 1] ?? "").toLowerCase();
  return base.includes("fixture") || base.includes("helper");
}
