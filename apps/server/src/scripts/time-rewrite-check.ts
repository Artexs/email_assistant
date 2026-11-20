import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { createCliOutput } from "../platform/cli";
import { describeError } from "../platform/errors";

import { compareHunk, importLines, timeValuesOf } from "./time-rewrite-check-values";

// A dev tool: no DB, no config (docs/code-patterns.md § Size and shape). The last stage of the time-spelling ticket deletes it.
export { compareHunk, timeValuesOf };

const out = createCliOutput("time-rewrite-check");

const exitClean = 0;
const exitMismatch = 1;
const exitUsage = 2;

const pathspecs = ["apps/*/src/**", "packages/*/src/**", "tools/*/src/**"];
const sourceFile = /\.(?:ts|tsx|js|mjs)$/;
/** The tool and its test hold unit names as plain data; they are not a rewrite. */
const ownFile = /\/time-rewrite-check(?:-values)?(?:\.test)?\.ts$/;

interface NumberedLine {
  line: number;
  text: string;
}

interface Hunk {
  file: string;
  oldFile: string;
  /** First line of the hunk in the new file (the line before it, for a pure removal). */
  newStart: number;
  oldStart: number;
  removed: NumberedLine[];
  added: NumberedLine[];
}

/** Hunks of the diff text of `git diff` with no context lines. Only source files, and not the tool's own files. */
export function parseDiff(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let oldFile = "";
  let file = "";
  let current: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  for (const text of diff.split("\n")) {
    if (text.startsWith("diff --git ")) {
      current = null;
    } else if (current === null && text.startsWith("--- ")) {
      oldFile = text.slice(4).replace(/^a\//, "");
    } else if (current === null && text.startsWith("+++ ")) {
      file = text.slice(4).replace(/^b\//, "");
      if (file === "/dev/null") {
        file = oldFile;
      }
    } else if (text.startsWith("@@ ")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (match === null || !sourceFile.test(file) || ownFile.test(file)) {
        current = null;
        continue;
      }
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      current = { file, oldFile, oldStart: oldLine, newStart: newLine, removed: [], added: [] };
      hunks.push(current);
    } else if (current !== null && text.startsWith("-")) {
      current.removed.push({ line: oldLine, text: text.slice(1) });
      oldLine += 1;
    } else if (current !== null && text.startsWith("+")) {
      current.added.push({ line: newLine, text: text.slice(1) });
      newLine += 1;
    }
  }
  return hunks;
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitOrEmpty(args: string[]): string {
  try {
    return git(args);
  } catch {
    return "";
  }
}

function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Lines of a hunk that are not import or re-export lines. */
function codeLines(lines: NumberedLine[], imports: Set<number>): string[] {
  return lines.filter((line) => !imports.has(line.line)).map((line) => line.text);
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.length > 1) {
    out.fail("usage: bun apps/server/src/scripts/time-rewrite-check.ts [base]");
    return exitUsage;
  }
  const root = git(["rev-parse", "--show-toplevel"]).trim();
  const base = args[0] ?? git(["-C", root, "merge-base", "HEAD", "master"]).trim();
  const diff = git([
    "-C",
    root,
    "diff",
    "-U0",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--no-color",
    "--no-ext-diff",
    base,
    "--",
    ...pathspecs,
  ]);
  const oldImports = new Map<string, Set<number>>();
  const newImports = new Map<string, Set<number>>();
  const hunks = parseDiff(diff);
  let mismatches = 0;
  for (const hunk of hunks) {
    if (!oldImports.has(hunk.oldFile)) {
      oldImports.set(hunk.oldFile, importLines(gitOrEmpty(["-C", root, "show", `${base}:${hunk.oldFile}`])));
    }
    if (!newImports.has(hunk.file)) {
      newImports.set(hunk.file, importLines(readOrEmpty(`${root}/${hunk.file}`)));
    }
    const result = compareHunk(
      codeLines(hunk.removed, oldImports.get(hunk.oldFile) ?? new Set()),
      codeLines(hunk.added, newImports.get(hunk.file) ?? new Set())
    );
    if (result !== null) {
      out.print(
        `${hunk.file}:${hunk.newStart} removed=[${result.removed.join(", ")}] added=[${result.added.join(", ")}]`
      );
      mismatches += 1;
    }
  }
  if (mismatches > 0) {
    out.fail(`${mismatches} of ${hunks.length} hunks changed a time value.`);
    return exitMismatch;
  }
  out.print(`time values equal: ${hunks.length} hunks`);
  return exitClean;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (error) {
    out.fail(`failed: ${describeError(error)}`);
    process.exit(exitUsage);
  }
}
