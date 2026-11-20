import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const SERVER_SRC = join(import.meta.dir, "..");
// Helper files of a script are no entry points: they open no mail connection. A `-load.ts` file reads corpus files
// and parses mail text; the entry point that calls it owns the process. `eval-suspicious.ts` only reads a pure link
// extractor of the mail module and runs inside `eval.ts`.
const EXCLUDED_SUFFIXES = [
  ".test.ts",
  "-args.ts",
  "-lines.ts",
  "-rows.ts",
  "-commands.ts",
  "-load.ts",
  "-suspicious.ts",
];
const MAIL_IMPORT = /from "\.\.\/modules\/mail|from "\.\.\/composition"/;

function selectedFiles(): string[] {
  const scripts = readdirSync(import.meta.dir)
    .filter((name) => name.endsWith(".ts") && !EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix)))
    .filter((name) => MAIL_IMPORT.test(readFileSync(join(import.meta.dir, name), "utf8")))
    .map((name) => join("scripts", name));
  // The mailbox runner is no entry point, but it builds the deps of the mailbox tools.
  return ["main.ts", ...scripts, "scripts/lib/mailbox-cli.ts"];
}

// A process that opens mail connections must set the host policy itself: without a call, the guard refuses local hosts.
describe("entry points that reach mail", () => {
  const files = selectedFiles();

  test("the selection holds the known entry points", () => {
    for (const name of ["main.ts", "scripts/job-run.ts", "scripts/mailbox-connect.ts", "scripts/mailbox-probe.ts"]) {
      expect(files).toContain(name);
    }
  });

  // `withMailboxDeps` (scripts/lib/mailbox-cli.ts) builds the production deps for the mailbox tools: it sets the policy before `run`.
  test("each one calls configureMailHosts, or runs through withMailboxDeps, which does", () => {
    const missing = files.filter((name) => {
      const text = readFileSync(join(SERVER_SRC, name), "utf8");
      const viaRunner = name !== "scripts/lib/mailbox-cli.ts" && text.includes("withMailboxDeps(");
      return !text.includes("configureMailHosts(") && !viaRunner;
    });
    expect(missing).toEqual([]);
    expect(files).toContain("scripts/lib/mailbox-cli.ts");
  });
});
