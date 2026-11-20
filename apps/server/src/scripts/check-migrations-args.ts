import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";

import { CONTRACT_CHECK_AFTER } from "./lib/check-migrations-rules";

export const cliDescriptions = [
  {
    name: "db:check-migrations",
    summary: "Finds contract statements in new migrations that lack a contract line.",
    risk: "read",
    needs: ["none"],
    usage: "bun run db:check-migrations [--dir <folder>] [--after <14-digit timestamp>]",
    exits: { 1: "a migration holds a contract statement without a `-- contract: v<x.y.z>` line" },
    outputNote: "file names, line numbers and rule names of the findings",
  },
] satisfies readonly CliDescription[];

export const DEFAULT_MIGRATIONS_DIR = "db/migrations";

/** `--dir` (default `db/migrations`) and `--after` (default `CONTRACT_CHECK_AFTER`). Throws `UsageError` (or a `parseArgs` error, also exit 2) on any bad argument. */
export function parseCheckMigrationsArgs(argv: string[]): { dir: string; after: string } {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { dir: { type: "string" }, after: { type: "string" } },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length > 0) throw new UsageError("db:check-migrations takes no operand");
  const after = values.after ?? CONTRACT_CHECK_AFTER;
  if (!/^\d{14}$/.test(after)) throw new UsageError("--after needs a 14-digit timestamp");
  const dir = values.dir ?? DEFAULT_MIGRATIONS_DIR;
  if (dir === "") throw new UsageError("--dir needs a folder");
  return { dir, after };
}
