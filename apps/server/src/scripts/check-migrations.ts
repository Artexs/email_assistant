import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createCliOutput } from "../platform/cli";
import { describeError } from "../platform/errors";

import { checkMigrationsUsage, parseCheckMigrationsArgs } from "./check-migrations-args";
import { checkMigrationSql, migrationTimestamp } from "./lib/check-migrations-rules";

const out = createCliOutput("check-migrations");

const exitClean = 0;
const exitFindings = 1;
const exitUsage = 2;

/** Prints `<file>:<line> <rule>` for each contract statement without a `-- contract: v<x.y.z>` line. Exit 1 on a finding. */
function main(): number {
  const args = parseCheckMigrationsArgs(process.argv.slice(2));
  if (args === null) {
    out.fail(checkMigrationsUsage);
    return exitUsage;
  }
  const files = readdirSync(args.dir)
    .filter((name) => {
      const stamp = migrationTimestamp(name);
      return stamp !== null && stamp > args.after;
    })
    .sort();
  let count = 0;
  for (const name of files) {
    const path = join(args.dir, name);
    for (const finding of checkMigrationSql(readFileSync(path, "utf8"))) {
      out.print(`${path}:${finding.line} ${finding.rule}`);
      count += 1;
    }
  }
  if (count === 0) {
    out.print(`ok: ${files.length} migration file(s) after ${args.after}`);
    return exitClean;
  }
  out.fail(
    `${count} contract statement(s). Add a line "-- contract: v<x.y.z>" (the release that stopped the use), or make the change an expand step (docs/code-patterns.md § Migrations).`
  );
  return exitFindings;
}

try {
  process.exit(main());
} catch (error) {
  out.fail(`failed: ${describeError(error)}`);
  process.exit(exitUsage);
}
