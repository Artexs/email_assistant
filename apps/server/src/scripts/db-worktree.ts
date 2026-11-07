import { Client } from "pg";
import { z } from "zod";

import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";

import {
  adminUrl,
  hasWorktreeMark,
  isLoopbackHost,
  parseDbWorktreeArgs,
  sameServer,
  usage,
  withDatabase,
  worktreeDatabaseName,
  worktreeDbComment,
} from "./db-worktree-args";

const log = createLog("db-worktree");

const envSchema = z.object({
  MIGRATOR_DATABASE_URL: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
});

const exitDone = 0;
const exitFailure = 1;
const exitUsage = 2;

function sqlState(error: unknown): string | undefined {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : undefined;
}

async function withClient<T>(url: string, run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function markOf(client: Client, database: string): Promise<{ exists: boolean; comment: string | null }> {
  const result = await client.query<{ comment: string | null }>(
    "SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = $1",
    [database]
  );
  const [row] = result.rows;
  return row === undefined ? { exists: false, comment: null } : { exists: true, comment: row.comment };
}

// The name was checked by `worktreeDatabaseName`; the quotes are a second guard.
function quoted(database: string): string {
  return `"${database}"`;
}

const refusal = (database: string): string =>
  `database ${database} exists but ${worktreeDbComment} did not create it: refusing`;

async function createDatabase(adminPostgresUrl: string, database: string): Promise<boolean> {
  return withClient(adminPostgresUrl, async (client) => {
    let mark = await markOf(client, database);
    let created = false;
    if (!mark.exists) {
      try {
        await client.query(`CREATE DATABASE ${quoted(database)}`);
        await client.query(`COMMENT ON DATABASE ${quoted(database)} IS '${worktreeDbComment}'`);
        log.info(`created ${database}`);
        mark = { exists: true, comment: worktreeDbComment };
        created = true;
      } catch (error) {
        if (sqlState(error) !== "42P04") throw error;
        mark = await markOf(client, database);
      }
    }
    if (!hasWorktreeMark(mark.comment)) {
      log.error(refusal(database));
      return false;
    }
    if (!created) log.info(`database ${database} exists, reusing it`);
    await client.query(`GRANT CONNECT ON DATABASE ${quoted(database)} TO migrator, app`);
    return true;
  });
}

async function grantSchema(adminDatabaseUrl: string): Promise<void> {
  await withClient(adminDatabaseUrl, async (client) => {
    await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await client.query("GRANT USAGE, CREATE ON SCHEMA public TO migrator");
    await client.query("GRANT USAGE ON SCHEMA public TO app");
  });
}

async function migrate(migratorUrl: string): Promise<boolean> {
  const child = Bun.spawn(["bun", "run", "db:migrate"], {
    env: { ...process.env, MIGRATOR_DATABASE_URL: migratorUrl },
    stdout: "inherit",
    stderr: "inherit",
  });
  return (await child.exited) === 0;
}

async function dropDatabase(adminPostgresUrl: string, database: string): Promise<number> {
  return withClient(adminPostgresUrl, async (client) => {
    const mark = await markOf(client, database);
    if (!mark.exists) {
      log.info(`no database ${database}`);
      return exitDone;
    }
    if (!hasWorktreeMark(mark.comment)) {
      log.error(refusal(database));
      return exitFailure;
    }
    try {
      await client.query(`DROP DATABASE ${quoted(database)}`);
    } catch (error) {
      const state = sqlState(error);
      if (state === "55006") {
        log.error(`database ${database} is in use: stop the server and the tests that use it`);
        return exitFailure;
      }
      if (state === "3D000") {
        log.info(`no database ${database}`);
        return exitDone;
      }
      throw error;
    }
    log.info(`dropped ${database}`);
    return exitDone;
  });
}

// Creates or drops an own database on the dev Postgres for one worktree. It runs as `postgres`, so it
// touches only a database that it marked itself and only on a loopback host.
async function main(): Promise<number> {
  const args = parseDbWorktreeArgs(process.argv.slice(2));
  const env = envSchema.safeParse(process.env);
  if (args === null || !env.success) {
    if (args !== null && !env.success) {
      log.error(`env check failed: ${env.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
    }
    log.error(usage);
    return exitUsage;
  }
  const { MIGRATOR_DATABASE_URL, DATABASE_URL, POSTGRES_PASSWORD } = env.data;
  const database = worktreeDatabaseName(args.name);
  if (database === null) {
    log.error(`bad name\n${usage}`);
    return exitUsage;
  }
  try {
    const protectedNames = [DATABASE_URL, MIGRATOR_DATABASE_URL].map((url) => new URL(url).pathname.slice(1));
    if (protectedNames.includes(database)) {
      log.error(`${database} is a base database: refusing`);
      return exitFailure;
    }
    if (
      !isLoopbackHost(DATABASE_URL) ||
      !isLoopbackHost(MIGRATOR_DATABASE_URL) ||
      !sameServer(DATABASE_URL, MIGRATOR_DATABASE_URL)
    ) {
      log.error("DATABASE_URL and MIGRATOR_DATABASE_URL must point at the same loopback server: refusing");
      return exitFailure;
    }
    const adminPostgresUrl = adminUrl(MIGRATOR_DATABASE_URL, POSTGRES_PASSWORD);
    if (args.drop) return await dropDatabase(adminPostgresUrl, database);
    if (!(await createDatabase(adminPostgresUrl, database))) return exitFailure;
    await grantSchema(withDatabase(adminPostgresUrl, database));
    const migratorUrl = withDatabase(MIGRATOR_DATABASE_URL, database);
    if (!(await migrate(migratorUrl))) {
      log.error("db:migrate failed");
      return exitFailure;
    }
    process.stdout.write(`DATABASE_URL=${withDatabase(DATABASE_URL, database)}\n`);
    process.stdout.write(`MIGRATOR_DATABASE_URL=${migratorUrl}\n`);
    return exitDone;
  } catch (error) {
    log.error(`failed: ${describeError(error)}`);
    return exitFailure;
  }
}

process.exit(await main());
