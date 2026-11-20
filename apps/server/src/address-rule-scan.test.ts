import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import ts from "typescript";

// Loops, delegation, the send limit and the sender rules compare addresses with one rule: `normalizeAddress` (`@ea/core`)
// in code and `normalizedAddress` (`platform/db`) in SQL (`docs/code-patterns.md` § Data access). A private lower-case fold
// of an address in these files brings back two answers for one person. This scan flags such a fold; a line that is not an
// address carries a comment `// not an address: <reason>` (same line or the line before, a reason of two words or more).
const root = resolve(import.meta.dir, "../../..");

const SCANNED_ROOTS = [
  "apps/server/src/modules/loops/",
  "apps/server/src/modules/delegation/",
  "packages/core/src/loops/",
];
const SCANNED_FILES = ["packages/core/src/send-limits.ts", "packages/core/src/triage/rules.ts"];

const FOLD_CALLS = new Set(["toLowerCase", "toLocaleLowerCase"]);
const SQL_FOLD = /\b(lower|upper)\s*\(/i;
const SQL_ILIKE = /\bilike\b/i;
const FOLD_NAME = /^(lower|upper)$/i;
const MARKER = /\/\/\s*not an address:\s+\S+\s+\S+/;

interface Finding {
  line: number;
  what: string;
}

function lineOf(source: ts.SourceFile, pos: number): number {
  return source.getLineAndCharacterOfPosition(pos).line + 1;
}

// A template is one unit: the marker sits on the line before the template, so a head, middle or tail reports its template's line.
function templateStart(node: ts.Node): ts.Node {
  let current = node;
  while (current.parent && !ts.isTemplateExpression(current)) current = current.parent;
  return ts.isTemplateExpression(current) ? current : node;
}

function findings(file: string, text: string): Finding[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = text.split("\n");
  const found: Finding[] = [];
  const add = (line: number, what: string) => {
    const marked = MARKER.test(lines[line - 1] ?? "") || MARKER.test(lines[line - 2] ?? "");
    if (!marked) found.push({ line, what });
  };
  const checkText = (value: string, line: number) => {
    if (SQL_FOLD.test(value)) add(line, "lower( or upper( in a string");
    if (SQL_ILIKE.test(value)) add(line, "ilike in a string");
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      FOLD_CALLS.has(node.expression.name.text)
    ) {
      add(lineOf(source, node.expression.name.getStart(source)), `${node.expression.name.text} call`);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const line = lineOf(source, templateStart(node).getStart(source));
      checkText(node.text, line);
      if (FOLD_NAME.test(node.text)) add(line, `literal ${node.text}`);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      checkText(node.text, lineOf(source, templateStart(node).getStart(source)));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.sort((a, b) => a.line - b.line);
}

function scannedFiles(): string[] {
  const files = [...SCANNED_FILES];
  for (const dir of SCANNED_ROOTS) {
    for (const file of new Glob(`${dir}**/*.ts`).scanSync({ cwd: root })) {
      if (file.endsWith(".test.ts") || file.endsWith(".test-helper.ts")) continue;
      files.push(file);
    }
  }
  return files.sort();
}

describe("address-rule-scan: findings", () => {
  test("05-T1 a lower-case call on an address is one finding at its line", () => {
    expect(findings("a.ts", "const a = address.toLowerCase();")).toEqual([{ line: 1, what: "toLowerCase call" }]);
    expect(findings("a.ts", "const a = address.toLocaleLowerCase();")).toHaveLength(1);
    expect(findings("a.ts", "const a = 1;\nconst b = row.to[0]?.toLowerCase();")[0]?.line).toBe(2);
  });

  test("05-T2 an SQL fold, ilike or a fold function name is one finding each", () => {
    expect(findings("a.ts", "const q = sql`lower(g.email) = ${x}`;")).toHaveLength(1);
    expect(findings("a.ts", "const q = sql`LOWER (a)`;")).toHaveLength(1);
    expect(findings("a.ts", "const q = sql`upper(a)`;")).toHaveLength(1);
    expect(findings("a.ts", "const q = sql`a ILIKE b`;")).toHaveLength(1);
    expect(findings("a.ts", 'const q = eb.fn("lower", ["a"]);')).toHaveLength(1);
    expect(findings("a.ts", 'const q = eb.fn("UPPER", ["a"]);')).toHaveLength(1);
    // A fold after a substitution is found in the template tail, and reports the line of the template.
    expect(findings("a.ts", "const x = 1;\nconst q = sql`a = ${x} and lower(b) = ${y}`;")).toEqual([
      { line: 2, what: "lower( or upper( in a string" },
    ]);
    expect(findings("a.ts", 'const q = "ilike";')).toHaveLength(1);
  });

  test("05-T3 a marker with a reason of two words clears; none or one word does not", () => {
    expect(findings("a.ts", "x.toLowerCase(); // not an address: header token")).toEqual([]);
    expect(findings("a.ts", "x.toLowerCase(); // not an address:")).toHaveLength(1);
    expect(findings("a.ts", "x.toLowerCase(); // not an address: tag")).toHaveLength(1);
  });

  test("05-T4 the marker on the line before clears; on two lines before does not", () => {
    expect(findings("a.ts", "// not an address: header token\nx.toLowerCase();")).toEqual([]);
    expect(findings("a.ts", "// not an address: header token\nconst y = 1;\nx.toLowerCase();")).toHaveLength(1);
    expect(findings("a.ts", "// not an address: sql text\nconst q = sql`\n  a = b and lower(c)`;")).toEqual([]);
  });

  test("05-T5 a comment and the one rule are not findings", () => {
    expect(findings("a.ts", "// address.toLowerCase()\nconst a = normalizeAddress(x);")).toEqual([]);
    expect(findings("a.ts", "/* lower(a) ilike b */\nconst a = normalizedAddress(x);")).toEqual([]);
  });
});

describe("address-rule-scan: the scanned files", () => {
  test("05-T6 every root and file exists, and a root holds a scanned file", () => {
    for (const path of [...SCANNED_ROOTS, ...SCANNED_FILES]) expect(existsSync(resolve(root, path))).toBe(true);
    const files = scannedFiles();
    for (const dir of SCANNED_ROOTS) expect(files.some((file) => file.startsWith(dir))).toBe(true);
    for (const file of SCANNED_FILES) expect(files).toContain(file);
  });

  test("05-T7 no scanned file holds an unmarked address fold", () => {
    const hits: string[] = [];
    for (const file of scannedFiles()) {
      for (const finding of findings(file, readFileSync(resolve(root, file), "utf8"))) {
        hits.push(`${file}:${finding.line} ${finding.what}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
