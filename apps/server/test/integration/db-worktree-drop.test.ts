import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { Client } from "pg";

import { adminUrl } from "../../src/scripts/db-worktree-args";
import { runDbWorktree } from "../db-script";

// `db:worktree <name> --drop` also drops `<name>-e2e`, the e2e database that job prepare makes for the Playwright suites.
// Each test makes its own names (`f136t-<random>`). Never run `--drop e2e` here: it is the name of the shared e2e database.
const script = resolve(import.meta.dir, "../../src/scripts/db-worktree.ts");
const urls = { databaseUrl: process.env.DATABASE_URL ?? "", migratorUrl: process.env.MIGRATOR_DATABASE_URL ?? "" };
const password = process.env.POSTGRES_PASSWORD || "postgres";
const admin = adminUrl(urls.migratorUrl, password);
const databases: string[] = [];

function names(): { name: string; base: string; sibling: string } {
  const name = `f136t-${randomBytes(4).toString("hex")}`;
  const base = `email_assistant_${name.replaceAll("-", "_")}`;
  const sibling = `${base}_e2e`;
  databases.push(base, sibling);
  return { name, base, sibling };
}

async function withAdmin<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: admin });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function exists(database: string): Promise<boolean> {
  const result = await withAdmin((client) => client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]));
  return result.rowCount === 1;
}

async function drop(name: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", script, name, "--drop"], {
    env: {
      ...process.env,
      DATABASE_URL: urls.databaseUrl,
      MIGRATOR_DATABASE_URL: urls.migratorUrl,
      POSTGRES_PASSWORD: password,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

afterAll(async () => {
  for (const database of databases) {
    await withAdmin((client) => client.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`));
  }
});

describe("db-worktree --drop and the e2e sibling", () => {
  test("drops the base database and its sibling", async () => {
    const { name, base, sibling } = names();
    await runDbWorktree([name], urls);
    await runDbWorktree([`${name}-e2e`], urls);
    expect(await exists(base)).toBe(true);
    expect(await exists(sibling)).toBe(true);
    const result = await drop(name);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`dropped ${sibling}`);
    expect(result.stdout).toContain(`dropped ${base}`);
    expect(await exists(base)).toBe(false);
    expect(await exists(sibling)).toBe(false);
  });

  test("a missing sibling prints nothing about it", async () => {
    const { name, base, sibling } = names();
    await runDbWorktree([name], urls);
    const result = await drop(name);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`[db-worktree] dropped ${base}\n`);
    expect(result.stdout).not.toContain(sibling);
    expect(await exists(base)).toBe(false);
  });

  test("an unmarked sibling refuses the whole drop", async () => {
    const { name, base, sibling } = names();
    await runDbWorktree([name], urls);
    await withAdmin((client) => client.query(`CREATE DATABASE "${sibling}"`));
    const result = await drop(name);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`database ${sibling} exists but `);
    expect(result.stdout).toBe("");
    expect(await exists(base)).toBe(true);
    expect(await exists(sibling)).toBe(true);
  });

  test("an unmarked base refuses the whole drop and leaves the marked sibling", async () => {
    const { name, base, sibling } = names();
    await withAdmin((client) => client.query(`CREATE DATABASE "${base}"`));
    await runDbWorktree([`${name}-e2e`], urls);
    const result = await drop(name);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`database ${base} exists but `);
    expect(await exists(base)).toBe(true);
    expect(await exists(sibling)).toBe(true);
  });

  test("a missing base still drops the sibling", async () => {
    const { name, base, sibling } = names();
    await runDbWorktree([`${name}-e2e`], urls);
    const result = await drop(name);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`dropped ${sibling}`);
    expect(result.stdout).toContain(`no database ${base}`);
    expect(await exists(sibling)).toBe(false);
  });
});
