import { parseArgs } from "node:util";

import { CONTRACT_CHECK_AFTER } from "./lib/check-migrations-rules";

export const checkMigrationsUsage =
  "usage: bun run db:check-migrations [--dir <folder>] [--after <14-digit timestamp>]";

export const DEFAULT_MIGRATIONS_DIR = "db/migrations";

/** `--dir` (default `db/migrations`) and `--after` (default `CONTRACT_CHECK_AFTER`). null on any bad argument; the script prints the usage. */
export function parseCheckMigrationsArgs(argv: string[]): { dir: string; after: string } | null {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { dir: { type: "string" }, after: { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
    if (positionals.length > 0) return null;
    const after = values.after ?? CONTRACT_CHECK_AFTER;
    if (!/^\d{14}$/.test(after)) return null;
    const dir = values.dir ?? DEFAULT_MIGRATIONS_DIR;
    return dir === "" ? null : { dir, after };
  } catch {
    return null;
  }
}
