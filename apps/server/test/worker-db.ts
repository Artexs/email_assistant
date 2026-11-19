import { readdirSync } from "node:fs";
import { join } from "node:path";

import { Client } from "pg";

import { withDatabase } from "../src/scripts/db-worktree-args";

import { runDbWorktree } from "./db-script";

const migrationsDir = join(import.meta.dir, "../../../db/migrations");
const PREFIX = "email_assistant_";

// The name `db:worktree` takes for the database of one test worker: `<base database>_w<id>` (`email_assistant_w2`
// for the base `email_assistant`).
export function workerDatabaseName(baseDatabase: string, workerId: string): string {
  if (baseDatabase === "email_assistant") return `w${workerId}`;
  if (!baseDatabase.startsWith(PREFIX)) {
    throw new Error(`worker databases need a base database named email_assistant or ${PREFIX}<name>`);
  }
  return `${baseDatabase.slice(PREFIX.length)}_w${workerId}`;
}

async function isMigrated(migratorUrl: string): Promise<boolean> {
  const client = new Client({ connectionString: migratorUrl, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const { rows } = await client.query<{ n: number }>("select count(*)::int as n from schema_migrations");
    return rows[0]?.n === readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).length;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * `bun test --parallel=N` runs N files at once on one database: a test that counts rows of all organizations, or a
 * Down section that takes an ACCESS EXCLUSIVE lock, then sees or blocks the other files (F124). Each worker process runs
 * its files one after the other, so one database per worker (`BUN_TEST_WORKER_ID`) gives every file the same view as a
 * serial run. The worker database is made and migrated once, then kept for the next run. Switched on by
 * `EA_TEST_WORKER_DB=1` (the `test:int` script); a serial run keeps the database of `.env`.
 */
export async function useWorkerDatabase(): Promise<void> {
  const workerId = process.env.BUN_TEST_WORKER_ID;
  if (process.env.EA_TEST_WORKER_DB !== "1" || workerId === undefined) return;
  const baseUrl = (process.env.EA_TEST_BASE_DATABASE_URL ??= process.env.DATABASE_URL);
  const baseMigratorUrl = (process.env.EA_TEST_BASE_MIGRATOR_DATABASE_URL ??= process.env.MIGRATOR_DATABASE_URL);
  if (!baseUrl || !baseMigratorUrl) {
    throw new Error("DATABASE_URL and MIGRATOR_DATABASE_URL are needed for the worker databases of the tests");
  }
  const name = workerDatabaseName(decodeURIComponent(new URL(baseUrl).pathname.slice(1)), workerId);
  const database = `${PREFIX}${name}`;
  const url = withDatabase(baseUrl, database);
  const migratorUrl = withDatabase(baseMigratorUrl, database);
  if (process.env.EA_TEST_WORKER_DB_READY !== database) {
    if (!(await isMigrated(migratorUrl))) {
      await runDbWorktree([name], { databaseUrl: baseUrl, migratorUrl: baseMigratorUrl });
    }
    process.env.EA_TEST_WORKER_DB_READY = database;
  }
  process.env.DATABASE_URL = url;
  process.env.MIGRATOR_DATABASE_URL = migratorUrl;
}
