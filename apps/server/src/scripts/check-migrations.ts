import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { runCli, type CliSpec } from "../platform/cli";

import { cliDescriptions, parseCheckMigrationsArgs } from "./check-migrations-args";
import { checkMigrationSql, migrationTimestamp } from "./lib/check-migrations-rules";

const exitClean = 0;
const exitFindings = 1;

/** Prints `<file>:<line> <rule>` for each contract statement without a `-- contract: v<x.y.z>` line. Exit 1 on a finding. */
const main: CliSpec["main"] = async (argv, out) => {
  const args = parseCheckMigrationsArgs(argv);
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
};

if (import.meta.main) {
  await runCli({ prefix: "check-migrations", descriptions: cliDescriptions, main });
}
