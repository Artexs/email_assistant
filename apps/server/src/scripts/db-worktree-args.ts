import { parseArgs } from "node:util";

import { type CliDescription, UsageError } from "@ea/core";

export const cliDescriptions = [
  {
    name: "db:worktree",
    summary: "Creates or drops an own database for one worktree on the dev Postgres.",
    risk: "dev",
    needs: ["db"],
    usage: [
      "bun run db:worktree <name> [--drop]",
      "  name: lower-case letters, digits, _ and - (the first one a letter or digit); - becomes _.",
      "  Creates the database email_assistant_<name> on the dev Postgres, with grants and migrations,",
      "  and prints DATABASE_URL and MIGRATOR_DATABASE_URL for it. --drop removes it, its -e2e sibling and its test worker databases <name>_w<n>.",
      "  Needs DATABASE_URL, MIGRATOR_DATABASE_URL and POSTGRES_PASSWORD (a missing key exits 2).",
    ].join("\n"),
    exits: { 1: "failed, or refused: a base database, a non-loopback server or a database it did not create" },
  },
] satisfies readonly CliDescription[];

export interface DbWorktreeArgs {
  name: string;
  drop: boolean;
}

// Throws `UsageError` (or a `parseArgs` error, which `runCli` also maps to exit 2) on any bad argument.
export function parseDbWorktreeArgs(argv: string[]): DbWorktreeArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { drop: { type: "boolean" } },
    allowPositionals: true,
    strict: true,
  });
  const [name] = positionals;
  if (name === undefined) throw new UsageError("a name is needed");
  if (positionals.length !== 1) throw new UsageError("one name only");
  return { name, drop: values.drop === true };
}

const databasePrefix = "email_assistant_";
const maxIdentifierBytes = 63;

// Identifiers cannot be bound as SQL parameters, so this check is the guard against injection.
export function worktreeDatabaseName(name: string): string | null {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) return null;
  const database = `${databasePrefix}${name.replaceAll("-", "_")}`;
  return database.length <= maxIdentifierBytes ? database : null;
}

// The e2e database of a job: `db:worktree <name>-e2e`. Null when the sibling name is too long.
export function siblingDatabaseName(name: string): string | null {
  return worktreeDatabaseName(`${name}-e2e`);
}

export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export function adminUrl(url: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = "postgres";
  parsed.password = encodeURIComponent(password);
  parsed.pathname = "/postgres";
  return parsed.toString();
}

export function isLoopbackHost(url: string): boolean {
  return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
}

export function sameServer(a: string, b: string): boolean {
  return new URL(a).host === new URL(b).host;
}

// The mark that the script puts on each database that it creates.
export const worktreeDbComment = "db:worktree";

export function hasWorktreeMark(comment: string | null): boolean {
  return comment === worktreeDbComment;
}
