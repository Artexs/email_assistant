import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import ts from "typescript";

// A comment states a rule or a reason in words. A bare ticket or decision code has no meaning once its plan file moves
// (`.agents/limen/styleguide.md` "Avoid", `docs/code-patterns.md` § Comments). A ticket folder path (number, then a slug) is
// a pointer and passes; the bare ticket number does not. Strings and code are not read: only comment text.
const root = resolve(import.meta.dir, "../../..");
const roots = ["apps", "packages", "scripts", "tools"];
const skipped = /(^|\/)(node_modules|dist|\.dist-[a-z]+-test|\.astro|\.f132-logs|test-results|playwright-report)\//;

// A ticket number, a product decision number, a stage number, a review number, and one of the plan letters S, D, P, N, A, Q, T
// or U with one or two digits. A quarter written with its year is a date, not a code.
const CODE =
  /\bF\d{3}\b(?!-[a-z0-9])|\bPD-\d+\b|\b[Ss]tages? \d+[a-z]?\b|\b[Rr]eview (?:round )?\d+\b|\b[SDPNAQTU]\d{1,2}[a-z]?\b(?! \d{4}\b)/;

// Files whose comments name test fixtures by a short label that the same file defines: they are not plan codes.
const FIXTURE_LABELS: Record<string, RegExp> = {
  "apps/server/test/integration/channels-card-sync.test.ts": /\b[UC]\d\b/, // the two owners and their two sent cards
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

function bareCodes(file: string, text: string): string[] {
  const comments = /\.(ts|tsx|mjs|js)$/.test(file) ? tsComments(file, text) : lineComments(file, text);
  const fixture = FIXTURE_LABELS[file];
  const hits: string[] = [];
  for (const comment of comments) {
    comment.text.split("\n").forEach((line, index) => {
      const bare = fixture ? line.replace(new RegExp(fixture, "g"), "") : line;
      if (CODE.test(bare)) hits.push(`${file}:${comment.line + index}: ${line.trim()}`);
    });
  }
  return hits;
}

describe("comments carry no bare ticket or decision codes", () => {
  test("a comment that holds a code is found, and a ticket folder path, a quarter and a string are not", () => {
    expect(bareCodes("a.ts", "// the rule of D12\nconst x = 1;")).toHaveLength(1);
    expect(bareCodes("a.ts", "/* F115 stage 09 */\nconst x = 1;")).toHaveLength(1);
    expect(bareCodes("a.ts", "// see PD-044 and S3 and review 17")).toHaveLength(1);
    expect(bareCodes("a.ts", '// ticket folder F115-e6a-reply-drafts, a quarter ("Q3 2025")')).toEqual([]);
    expect(bareCodes("a.ts", 'const x = "F115 D12 stage 09";')).toEqual([]);
    expect(bareCodes("a.sh", "# the rule of D12")).toHaveLength(1);
  });

  test("no source file under apps, packages, scripts or tools holds one", () => {
    const hits: string[] = [];
    for (const dir of roots) {
      for (const file of new Glob(`${dir}/**/*.{ts,tsx,mjs,js,astro,css,sh}`).scanSync({ cwd: root })) {
        if (skipped.test(file)) continue;
        hits.push(...bareCodes(file, readFileSync(resolve(root, file), "utf8")));
      }
    }
    expect(hits).toEqual([]);
    // The scan reads every source file; on a loaded machine it needs more than the default 5 s.
  }, 60_000);
});
