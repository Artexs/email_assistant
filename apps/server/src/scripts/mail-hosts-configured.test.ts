import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const SERVER_SRC = join(import.meta.dir, "..");
// A `-load.ts` file reads corpus files and parses mail text; it opens no connection (the entry point that calls it does).
const EXCLUDED_SUFFIXES = [".test.ts", "-args.ts", "-lines.ts", "-rows.ts", "-load.ts"];
const MAIL_IMPORT = /from "\.\.\/modules\/mail|from "\.\.\/composition"/;

function selectedFiles(): string[] {
  const scripts = readdirSync(import.meta.dir)
    .filter((name) => name.endsWith(".ts") && !EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix)))
    .filter((name) => MAIL_IMPORT.test(readFileSync(join(import.meta.dir, name), "utf8")))
    .map((name) => join("scripts", name));
  return ["main.ts", ...scripts];
}

// A process that opens mail connections must set the host policy itself: without a call, the guard refuses local hosts.
describe("entry points that reach mail", () => {
  const files = selectedFiles();

  test("the selection holds the known entry points", () => {
    for (const name of [
      "main.ts",
      "scripts/job-run.ts",
      "scripts/mailbox-connect.ts",
      "scripts/mailbox-probe-send.ts",
    ]) {
      expect(files).toContain(name);
    }
  });

  test("each one calls configureMailHosts", () => {
    const missing = files.filter(
      (name) => !readFileSync(join(SERVER_SRC, name), "utf8").includes("configureMailHosts(")
    );
    expect(missing).toEqual([]);
  });
});
