import { parseArgs } from "node:util";

export const usage = [
  "usage: bun run db:worktree <name> [--drop]",
  "  name: lower-case letters, digits, _ and - (the first one a letter or digit); - becomes _.",
  "  Creates the database email_assistant_<name> on the dev Postgres, with grants and migrations,",
  "  and prints DATABASE_URL and MIGRATOR_DATABASE_URL for it. --drop removes it.",
  "  Exit 0: done. Exit 1: failure or refusal. Exit 2: usage or env error.",
].join("\n");

export interface DbWorktreeArgs {
  name: string;
  drop: boolean;
}

// Returns null on any bad argument; the script prints the usage.
export function parseDbWorktreeArgs(argv: string[]): DbWorktreeArgs | null {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { drop: { type: "boolean" } },
      allowPositionals: true,
      strict: true,
    });
    const [name] = positionals;
    if (positionals.length !== 1 || name === undefined) return null;
    return { name, drop: values.drop === true };
  } catch {
    return null;
  }
}

const databasePrefix = "email_assistant_";
const maxIdentifierBytes = 63;

// Identifiers cannot be bound as SQL parameters, so this check is the guard against injection.
export function worktreeDatabaseName(name: string): string | null {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) return null;
  const database = `${databasePrefix}${name.replaceAll("-", "_")}`;
  return database.length <= maxIdentifierBytes ? database : null;
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
