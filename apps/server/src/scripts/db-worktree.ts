import { UsageError } from "@ea/core";
import { Client } from "pg";
import { z } from "zod";

import { type CliRawOutput, type CliSpec, runCli } from "../platform/cli";

import {
  adminUrl,
  hasWorktreeMark,
  isLoopbackHost,
  cliDescriptions,
  parseDbWorktreeArgs,
  sameServer,
  siblingDatabaseName,
  withDatabase,
  worktreeDatabaseName,
  worktreeDbComment,
} from "./db-worktree-args";

const envSchema = z.object({
  MIGRATOR_DATABASE_URL: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
});

const exitDone = 0;
const exitFailure = 1;

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

async function createDatabase(out: CliRawOutput, adminPostgresUrl: string, database: string): Promise<boolean> {
  return withClient(adminPostgresUrl, async (client) => {
    let mark = await markOf(client, database);
    let created = false;
    if (!mark.exists) {
      try {
        await client.query(`CREATE DATABASE ${quoted(database)}`);
        await client.query(`COMMENT ON DATABASE ${quoted(database)} IS '${worktreeDbComment}'`);
        out.print(`created ${database}`);
        mark = { exists: true, comment: worktreeDbComment };
        created = true;
      } catch (error) {
        if (sqlState(error) !== "42P04") throw error;
        mark = await markOf(client, database);
      }
    }
    if (!hasWorktreeMark(mark.comment)) {
      out.fail(refusal(database));
      return false;
    }
    if (!created) out.print(`database ${database} exists, reusing it`);
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

async function dropOne(out: CliRawOutput, client: Client, database: string): Promise<number> {
  const mark = await markOf(client, database);
  if (!mark.exists) {
    out.print(`no database ${database}`);
    return exitDone;
  }
  if (!hasWorktreeMark(mark.comment)) {
    out.fail(refusal(database));
    return exitFailure;
  }
  try {
    await client.query(`DROP DATABASE ${quoted(database)}`);
  } catch (error) {
    const state = sqlState(error);
    if (state === "55006") {
      out.fail(`database ${database} is in use: stop the server and the tests that use it`);
      return exitFailure;
    }
    if (state === "3D000") {
      out.print(`no database ${database}`);
      return exitDone;
    }
    throw error;
  }
  out.print(`dropped ${database}`);
  return exitDone;
}

// `bun test --parallel` makes one database per test worker, `<name>_w<n>` (`apps/server/test/worker-db.ts`). A drop of the
// base database drops them too, each with its own mark check. The name holds only [a-z0-9_] (`worktreeDatabaseName`).
async function dropWithWorkers(out: CliRawOutput, client: Client, database: string): Promise<number> {
  const workers = await client.query<{ datname: string }>(
    "SELECT datname FROM pg_database WHERE datname ~ $1 ORDER BY datname",
    [`^${database}_w[0-9]+$`]
  );
  let code = await dropOne(out, client, database);
  for (const worker of workers.rows) code = Math.max(code, await dropOne(out, client, worker.datname));
  return code;
}

// A drop covers the base database and its e2e sibling (`<name>-e2e`, made by prepare for the Playwright suites). The
// marks of both are read first: a database that the script did not create stops the whole command, with nothing dropped.
// A missing sibling prints nothing. The sibling goes first; an in-use error on either one stops the command.
async function dropDatabase(
  out: CliRawOutput,
  adminPostgresUrl: string,
  database: string,
  sibling: string | null
): Promise<number> {
  return withClient(adminPostgresUrl, async (client) => {
    for (const name of sibling === null ? [database] : [database, sibling]) {
      const mark = await markOf(client, name);
      if (mark.exists && !hasWorktreeMark(mark.comment)) {
        out.fail(refusal(name));
        return exitFailure;
      }
    }
    if (sibling !== null && (await markOf(client, sibling)).exists) {
      const code = await dropWithWorkers(out, client, sibling);
      if (code !== exitDone) return code;
    }
    return dropWithWorkers(out, client, database);
  });
}

// Creates or drops an own database on the dev Postgres for one worktree. It runs as `postgres`, so it
// touches only a database that it marked itself and only on a loopback host.
const main: CliSpec["main"] = async (argv, out) => {
  const args = parseDbWorktreeArgs(argv);
  const env = envSchema.safeParse(process.env);
  if (!env.success) {
    throw new UsageError(`env check failed: ${env.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  const { MIGRATOR_DATABASE_URL, DATABASE_URL, POSTGRES_PASSWORD } = env.data;
  const database = worktreeDatabaseName(args.name);
  if (database === null) throw new UsageError("bad name");
  const protectedNames = [DATABASE_URL, MIGRATOR_DATABASE_URL].map((url) => new URL(url).pathname.slice(1));
  if (protectedNames.includes(database)) {
    out.fail(`${database} is a base database: refusing`);
    return exitFailure;
  }
  if (
    !isLoopbackHost(DATABASE_URL) ||
    !isLoopbackHost(MIGRATOR_DATABASE_URL) ||
    !sameServer(DATABASE_URL, MIGRATOR_DATABASE_URL)
  ) {
    out.fail("DATABASE_URL and MIGRATOR_DATABASE_URL must point at the same loopback server: refusing");
    return exitFailure;
  }
  const adminPostgresUrl = adminUrl(MIGRATOR_DATABASE_URL, POSTGRES_PASSWORD);
  if (args.drop) return await dropDatabase(out, adminPostgresUrl, database, siblingDatabaseName(args.name));
  if (!(await createDatabase(out, adminPostgresUrl, database))) return exitFailure;
  await grantSchema(withDatabase(adminPostgresUrl, database));
  const migratorUrl = withDatabase(MIGRATOR_DATABASE_URL, database);
  if (!(await migrate(migratorUrl))) {
    out.fail("db:migrate failed");
    return exitFailure;
  }
  out.write(`DATABASE_URL=${withDatabase(DATABASE_URL, database)}\n`);
  out.write(`MIGRATOR_DATABASE_URL=${migratorUrl}\n`);
  return exitDone;
};

if (import.meta.main) {
  await runCli({ prefix: "db-worktree", descriptions: cliDescriptions, main });
}
