import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, test } from "bun:test";

// Guard: no code names the retired columns of `emails` (`inbox_uid`, `undo_pending_at`).
// Until the contract migration drops them they still typecheck (they are in `schema.ts`) and raw `sql`
// strings never typecheck, so only a source scan keeps another branch from writing them again.

const RETIRED: readonly { name: string; pattern: RegExp }[] = [
  { name: "inbox_uid", pattern: /\binbox_uid\b/ },
  { name: "undo_pending_at", pattern: /\bundo_pending_at\b/ },
  { name: "undoPendingAt", pattern: /undoPendingAt/ },
  { name: "UndoPending", pattern: /UndoPending/ },
  { name: "inboxUid", pattern: /\binboxUid\b/ },
];

/** Path (from the repo root, `/` separated) to the retired names the file may hold; `"*"` is every name. */
export const RETIRED_COLUMN_ALLOW: Readonly<Record<string, readonly string[] | "*">> = {
  // The generated schema keeps the columns until the contract migration.
  "apps/server/src/platform/db/schema.ts": "*",
  // The excluded entries of the data export map (a test needs every column listed).
  "apps/server/src/modules/privacy/export-map/tables-e-m.ts": "*",
  // This file names the retired columns on purpose.
  "apps/server/src/platform/db/retired-columns.test.ts": "*",
  // The test of the copy trigger writes the old names on purpose.
  "apps/server/test/integration/emails-renamed-columns-schema.test.ts": "*",
  // The probe tool names the UID in INBOX, which is correct for it.
  "apps/server/src/modules/mail/imap/probe-move.ts": ["inboxUid"],
  "apps/server/test/integration/imap-probe-move.test.ts": ["inboxUid"],
};

const ROOTS = ["apps", "packages", "tools", "scripts"];
const EXTENSIONS = [".ts", ".tsx", ".astro", ".js", ".sql"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".astro", ".cache", ".turbo", "build", "coverage", ".output"]);

interface SourceFile {
  path: string;
  text: string;
}

/** One finding per retired name on a line: `<path>:<line> <name>`. */
export function findRetiredNames(
  files: readonly SourceFile[],
  allow: Readonly<Record<string, readonly string[] | "*">> = RETIRED_COLUMN_ALLOW
): string[] {
  const findings: string[] = [];
  for (const file of files) {
    const allowed = allow[file.path];
    if (allowed === "*") continue;
    file.text.split("\n").forEach((line, index) => {
      for (const { name, pattern } of RETIRED) {
        if (pattern.test(line) && !allowed?.includes(name)) findings.push(`${file.path}:${index + 1} ${name}`);
      }
    });
  }
  return findings;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      out.push(join(dir, entry.name));
    }
  }
}

function readRepoFiles(): SourceFile[] {
  const repoRoot = join(import.meta.dir, "..", "..", "..", "..", "..");
  const paths: string[] = [];
  for (const root of ROOTS) walk(join(repoRoot, root), paths);
  return paths.map((path) => ({
    path: relative(repoRoot, path).split(sep).join("/"),
    text: readFileSync(path, "utf8"),
  }));
}

describe("retired emails column names", () => {
  test("no file under apps, packages, tools or scripts names a retired column outside the allow list", () => {
    const files = readRepoFiles();
    // A scan that read nothing would pass for the wrong reason.
    expect(files.some((file) => file.path === "apps/server/src/platform/db/schema.ts")).toBe(true);
    expect(findRetiredNames(files)).toEqual([]);
  });

  test("every allow list entry names a file that exists and holds a retired name", () => {
    const byPath = new Map(readRepoFiles().map((file) => [file.path, file.text]));
    const stale = Object.entries(RETIRED_COLUMN_ALLOW)
      .filter(([path]) => {
        const text = byPath.get(path);
        return text === undefined || !RETIRED.some(({ pattern }) => pattern.test(text));
      })
      .map(([path]) => path);
    expect(stale).toEqual([]);
  });

  test("a retired name in an unlisted file is a finding with its path and line", () => {
    const files = [{ path: "apps/server/src/x.ts", text: "const a = 1;\nSELECT inbox_uid FROM emails" }];
    expect(findRetiredNames(files)).toEqual(["apps/server/src/x.ts:2 inbox_uid"]);
  });

  test("the same text in schema.ts is no finding", () => {
    const files = [{ path: "apps/server/src/platform/db/schema.ts", text: "inbox_uid" }];
    expect(findRetiredNames(files)).toEqual([]);
  });

  test("inboxUid in the probe tool is no finding, undoPendingAt there is", () => {
    const path = "apps/server/src/modules/mail/imap/probe-move.ts";
    expect(findRetiredNames([{ path, text: "const inboxUid = 1;" }])).toEqual([]);
    expect(findRetiredNames([{ path, text: "const undoPendingAt = 1;" }])).toEqual([`${path}:1 undoPendingAt`]);
  });

  test.each([
    ["undo_pending_at", "undo_pending_at"],
    ["UndoPending", "setUndoPending(db)"],
    ["inboxUid", "const inboxUid = 4;"],
  ])("%s is a finding in an unlisted file", (name, text) => {
    expect(findRetiredNames([{ path: "packages/core/src/y.ts", text }])).toEqual([`packages/core/src/y.ts:1 ${name}`]);
  });

  test("a longer name that only contains the retired word is no finding", () => {
    const text = "const mailbox_inbox_uid_count = 1; const inboxUidMap = 2;";
    expect(findRetiredNames([{ path: "packages/core/src/z.ts", text }])).toEqual([]);
  });
});
