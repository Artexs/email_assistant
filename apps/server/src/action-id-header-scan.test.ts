import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import ts from "typescript";

// The header `X-EA-Action-Id` marks the system's own mail; every sync, backfill and history run finds own mail by it. One typo in a
// hand-spelled name turns own drafts into foreign mail. `ACTION_ID_HEADER` and `ACTION_ID_HEADER_KEY` (`@ea/core`) hold the name; this scan
// flags every other spelling in production code. Tests keep the literal on purpose: they check the wire format independently.
const root = resolve(import.meta.dir, "../../..");

const SCANNED_ROOTS = ["apps/*/src", "packages/*/src", "scripts"];
const EXCLUDED = [/\.test\.tsx?$/, /\.spec\.ts$/, /\.test-helper\.ts$/, /(^|\/)test\//, /(^|\/)e2e\//];
const ALLOWED_FILE = "packages/core/src/outgoing/headers.ts";
const HEADER_NAME = /x-ea-action-id/i;

interface Finding {
  line: number;
  what: string;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

// Comments are not tokens, so a comment that names the header in prose is never a finding.
function findings(file: string, text: string): Finding[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const found: Finding[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (HEADER_NAME.test(node.text)) found.push({ line: lineOf(source, node), what: "string" });
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (HEADER_NAME.test(node.text)) found.push({ line: lineOf(source, node), what: "template part" });
    } else if (ts.isRegularExpressionLiteral(node)) {
      if (HEADER_NAME.test(node.text)) found.push({ line: lineOf(source, node), what: "regex literal" });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.sort((a, b) => a.line - b.line);
}

function scannedFiles(): string[] {
  const files: string[] = [];
  for (const dir of SCANNED_ROOTS) {
    for (const file of new Glob(`${dir}/**/*.{ts,tsx}`).scanSync({ cwd: root })) {
      if (EXCLUDED.some((pattern) => pattern.test(file))) continue;
      files.push(file);
    }
  }
  return files.sort();
}

describe("action-id-header-scan: findings", () => {
  test.each([
    ["a string literal", 1, 'const a = "X-EA-Action-Id";'],
    ["a template part", 1, "const b = `x-ea-action-id: ${v}`;"],
    ["a property name in odd case", 1, 'const c = { "x-Ea-AcTion-iD": v };'],
    ["a regex literal", 1, "const r = /x-ea-action-id/i;"],
    ["a line comment", 0, "// the X-EA-Action-Id header"],
    ["a block comment", 0, "/** X-EA-Action-Id */ const d = 1;"],
    ["another header", 0, 'const e = "X-EA-Probe";'],
  ])("%s gives %i findings", (_name, count, text) => {
    expect(findings("a.ts", text)).toHaveLength(count);
  });
});

describe("action-id-header-scan: the scanned files", () => {
  test("the scan reads the writer and the reader of the header", () => {
    const files = scannedFiles();
    expect(files).toContain("packages/core/src/outgoing/message.ts");
    expect(files).toContain("apps/server/src/modules/mail/imap/mapper.ts");
    expect(files).toContain(ALLOWED_FILE);
  });

  test("the one allowed file holds the name, so the allow is what keeps it clear", () => {
    expect(findings(ALLOWED_FILE, readFileSync(resolve(root, ALLOWED_FILE), "utf8"))).toHaveLength(2);
  });

  test("no production file spells the header name by hand", () => {
    const hits: string[] = [];
    for (const file of scannedFiles()) {
      if (file === ALLOWED_FILE) continue;
      for (const finding of findings(file, readFileSync(resolve(root, file), "utf8"))) {
        hits.push(`${file}:${finding.line} ${finding.what}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
