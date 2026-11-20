import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { MINUTE_MS } from "@ea/core";
import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import ts from "typescript";

// A comment, a string or a document states a rule or a reason in words. A bare ticket or decision code has no meaning once its
// plan file moves (`.agents/limen/styleguide.md` "Avoid", `docs/code-patterns.md` § Comments). A ticket folder path (number,
// then a slug) is a pointer and passes; the bare ticket number does not. The scan reads comments, the strings and JSX text of
// non-test source files, every string of the JSON files, the docs site pages and `docs/modules.md`. The operator runbooks that
// the docs site shows in place (`deploy/README.md`, `docs/release-checklist.md`) are not read.
const root = resolve(import.meta.dir, "../../..");
const roots = ["apps", "packages", "scripts", "tools"];
const skipped = /(^|\/)(node_modules|dist|\.dist-[a-z]+-test|\.astro|\.f132-logs|test-results|playwright-report)\//;

// A ticket number, a product decision number, a stage number, a review number, and one of the plan letters S, D, P, N, A, Q, T
// or U with one or two digits. A quarter written with its year is a date, not a code.
const CODE =
  /\bF\d{3}\b(?!-[a-z0-9])|\bPD-\d+\b|\b[Ss]tages? \d+[a-z]?\b|\b[Rr]eview (?:round )?\d+\b|\b[SDPNAQTU]\d{1,2}[a-z]?\b(?! \d{4}\b)/;

// Strings and JSON hold data ids that look like single-letter codes (audit flags, transition ids, the "T" of a timestamp),
// so they are checked for the long forms only.
const STRING_CODE = /\bF\d{3}\b(?!-[a-z0-9])|\bPD-\d+\b|\b[Ss]tages? \d+[a-z]?\b|\b[Rr]eview (?:round )?\d+\b/;

// Test files own their strings and fixtures (their comments stay scanned).
const TEST_FILE = /\.test\.tsx?$|\.test-helper\.ts$|(^|\/)(test|e2e)\//;

// Files whose comments name test fixtures by a short label that the same file defines: they are not plan codes.
const FIXTURE_LABELS: Record<string, RegExp> = {
  "apps/server/test/integration/channels-card-sync-decisions.test.ts": /\b[UC]\d\b/, // the two owners and their two sent cards
  "apps/server/test/integration/channels-card-sync-helpers.ts": /\b[UC]\d\b/, // the two owners and their two sent cards
  "apps/server/test/integration/channels-card-sync-hooks.test.ts": /\b[UC]\d\b/, // the two owners and their two sent cards
  "apps/server/test/integration/channels-card-sync-probes.test.ts": /\b[UC]\d\b/, // the two owners and their two sent cards
  "apps/server/test/integration/web-approvals-kit.ts": /\bU\d\b/, // the two owners
  "apps/server/test/integration/web-delegations.test.ts": /\b[DU]\d\b/, // the six delegations and the two owners
};

interface Comment {
  line: number;
  text: string;
}

function tsComments(file: string, text: string): Comment[] {
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found = new Map<number, Comment>();
  const add = (ranges: ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) {
      found.set(range.pos, {
        line: source.getLineAndCharacterOfPosition(range.pos).line + 1,
        text: text.slice(range.pos, range.end),
      });
    }
  };
  const visit = (node: ts.Node) => {
    add(ts.getLeadingCommentRanges(text, node.getFullStart()));
    add(ts.getTrailingCommentRanges(text, node.getEnd()));
    node.getChildren(source).forEach(visit);
  };
  visit(source);
  add(ts.getLeadingCommentRanges(text, source.endOfFileToken.getFullStart()));
  return [...found.values()];
}

// Shell, CSS and Astro files have no parser here: a line pattern finds their comments.
function lineComments(file: string, text: string): Comment[] {
  const pattern = file.endsWith(".sh")
    ? /(?:^|\s)#(?!!).*$/gm
    : file.endsWith(".css")
      ? /\/\*[\s\S]*?\*\//g
      : /<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|(?<![:"'`\w])\/\/.*$/gm;
  return [...text.matchAll(pattern)].map((match) => ({
    line: text.slice(0, match.index).split("\n").length,
    text: match[0],
  }));
}

function isTextNode(node: ts.Node): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  );
}

// The text of each string literal, template part and JSX text node of a source file (a template part is scanned alone).
function tsStrings(file: string, text: string): Comment[] {
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found: Comment[] = [];
  const visit = (node: ts.Node) => {
    if (isTextNode(node) || ts.isJsxText(node)) {
      found.push({
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        text: node.getText(source),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

// Every string of a JSON file, keys and values. A comment or a trailing comma parses, as in a `tsconfig`.
function jsonHits(file: string, text: string): string[] {
  if (ts.parseConfigFileTextToJson(file, text).error) return [`${file}: cannot parse`];
  const source = ts.parseJsonText(file, text);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) && STRING_CODE.test(node.text)) {
      hits.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

function markdownHits(file: string, text: string): string[] {
  const hits: string[] = [];
  text.split("\n").forEach((line, index) => {
    if (CODE.test(line)) hits.push(`${file}:${index + 1}: ${line.trim()}`);
  });
  return hits;
}

function bareCodes(file: string, text: string): string[] {
  if (file.endsWith(".json")) return TEST_FILE.test(file) ? [] : jsonHits(file, text);
  if (/\.mdx?$/.test(file)) return markdownHits(file, text);
  const isTs = /\.(ts|tsx|mjs|js)$/.test(file);
  const comments = isTs ? tsComments(file, text) : lineComments(file, text);
  const fixture = FIXTURE_LABELS[file];
  const hits: string[] = [];
  if (isTs && !TEST_FILE.test(file)) {
    for (const part of tsStrings(file, text)) {
      part.text.split("\n").forEach((line, index) => {
        if (STRING_CODE.test(line)) hits.push(`${file}:${part.line + index}: ${line.trim()}`);
      });
    }
  }
  for (const comment of comments) {
    comment.text.split("\n").forEach((line, index) => {
      const bare = fixture ? line.replace(new RegExp(fixture, "g"), "") : line;
      if (CODE.test(bare)) hits.push(`${file}:${comment.line + index}: ${line.trim()}`);
    });
  }
  return hits;
}

const sourceFiles = (dir: string) => new Glob(`${dir}/**/*.{ts,tsx,mjs,js,astro,css,sh,json}`).scanSync({ cwd: root });

describe("comments, strings, JSON and docs carry no bare ticket or decision codes", () => {
  test.each([
    ["a comment with a decision code", "a.ts", "// the rule of D12\nconst x = 1;", 1],
    ["a block comment with a ticket and a stage", "a.ts", "/* F115 stage 09 */\nconst x = 1;", 1],
    ["a comment with a decision, a plan code and a review", "a.ts", "// see PD-044 and S3 and review 17", 1],
    [
      "a comment with a ticket folder and a quarter",
      "a.ts",
      '// ticket folder F115-e6a-reply-drafts, a quarter ("Q3 2025")',
      0,
    ],
    ["a string with a letter code", "a.ts", 'const x = "D12";', 0],
    ["a shell comment", "a.sh", "# the rule of D12", 1],
    ["a string with a ticket and a stage", "a.ts", 'const x = "see F115 stage 09";', 1],
    ["a string with a ticket folder path", "a.ts", 'const x = "spec/features/done/2026-11/F115-e6a-reply-drafts/";', 0],
    ["strings with letter codes and a time", "a.ts", 'const f = ["S1", "P1"]; const t = "T00:00:00Z";', 0],
    ["a template part", "a.ts", "const x = `a ${y} PD-083 b`;", 1],
    ["a JSX text", "a.tsx", "const e = <p>Added in F120</p>;", 1],
    ["a tagged template", "a.ts", "const q = sql`SELECT 1 -- open loops stage 10/11`;", 1],
    ["a test file", "a.test.ts", 'const x = "F115 stage 09";', 0],
    ["a comment in a test file", "a.test.ts", "// the rule of D12\nconst x = 1;", 1],
    ["a tsx test file", "a.test.tsx", 'const x = "F115 stage 09";', 0],
    ["a test helper", "a.test-helper.ts", 'const x = "F115 stage 09";', 0],
    ["a file in a test folder", "test/a.ts", 'const x = "F115 stage 09";', 0],
    ["a JSON file in an e2e folder", "e2e/a.json", '{"why": "F115 stage 09"}', 0],
    ["a JSON value with a ticket and stages", "a.json", '{"why": "the drafter pair (F115 stages 05 to 09)"}', 1],
    ["a JSON value in words", "a.json", '{"why": "the drafter pair"}', 0],
    ["a JSON key", "a.json", '{"F115 stage 09": 1}', 1],
    ["a JSON file with a comment and a trailing comma", "a.json", '{ /* note */ "a": "b", }', 0],
    ["a JSON file that does not parse", "a.json", '{"a": ', 1],
    ["a Markdown line with plan and ticket codes", "a.md", "Added in S4 (F102).", 1],
    ["a Markdown line with a ticket folder path", "a.md", "See `spec/features/done/2026-11/F102-x/`.", 0],
    ["a Markdown line with a quarter", "a.md", "Q3 2025 plan", 0],
  ])("%s", (_name, file, text, count) => {
    expect(bareCodes(file, text)).toHaveLength(count);
  });

  test(
    "no scanned file holds one",
    () => {
      const hits: string[] = [];
      const files: string[] = [];
      for (const dir of roots) files.push(...sourceFiles(dir));
      files.push(...new Glob("apps/docs/src/content/**/*.{md,mdx}").scanSync({ cwd: root }), "docs/modules.md");
      for (const file of files) {
        if (skipped.test(file)) continue;
        hits.push(...bareCodes(file, readFileSync(resolve(root, file), "utf8")));
      }
      expect(hits).toEqual([]);
      // The scan reads every source file; on a loaded machine it needs more than the default 5 s.
    },
    MINUTE_MS
  );
});
