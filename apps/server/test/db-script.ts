import { join } from "node:path";

import { Client } from "pg";

const script = join(import.meta.dir, "../src/scripts/db-worktree.ts");
const root = join(import.meta.dir, "../../..");

// One key for every `db-worktree` run of the tests: `CREATE DATABASE` fails when two sessions copy `template1` at once.
const CREATE_LOCK_KEY = 124_001;

/**
 * Runs `bun run db:worktree` (create and migrate, or drop, an own database on the dev Postgres) for a test. It needs
 * `POSTGRES_PASSWORD` (the dev `.env` has it; CI uses the password of its Postgres service). `urls.databaseUrl` is the database URL
 * the script gets as `DATABASE_URL`; the lock is held on it, so parallel test workers create one database at a time.
 */
export async function runDbWorktree(
  args: string[],
  urls: { databaseUrl: string; migratorUrl: string }
): Promise<string> {
  const lock = new Client({ connectionString: urls.databaseUrl });
  await lock.connect();
  try {
    await lock.query("select pg_advisory_lock($1)", [CREATE_LOCK_KEY]);
    const child = Bun.spawn(["bun", script, ...args], {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: urls.databaseUrl,
        MIGRATOR_DATABASE_URL: urls.migratorUrl,
        // CI sets no POSTGRES_PASSWORD; the fallback is the password of the CI Postgres service (`ci.yml`), not a secret.
        POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || "postgres",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) {
      throw new Error(`db-worktree ${args.join(" ")} exited ${code}: ${err.trim() || out.trim()}`);
    }
    return out;
  } finally {
    await lock.end();
  }
}
