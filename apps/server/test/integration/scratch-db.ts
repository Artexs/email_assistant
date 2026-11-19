import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { createDb, type Db } from "../../src/platform/db";

const script = join(import.meta.dir, "../../src/scripts/db-worktree.ts");
const root = join(import.meta.dir, "../../../..");

export interface ScratchDb {
  /** The table owner (migrator role) of the scratch database: the role that runs a Down or Up section. */
  owner: Db;
  /** Closes the pool and drops the database. */
  drop(): Promise<void>;
}

async function dbWorktree(args: string[]): Promise<string> {
  const child = Bun.spawn(["bun", script, ...args], {
    cwd: root,
    env: process.env,
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
}

/**
 * An own migrated database for a test that runs DDL (a Down or Up section). DDL takes ACCESS EXCLUSIVE locks and
 * deadlocks with the other files of a `bun test --parallel` run that read the same tables in the shared test database (F124).
 * It uses the `db:worktree` script, so it needs `POSTGRES_PASSWORD` (the dev `.env` has it; the CI test step sets it).
 */
export async function createScratchDb(): Promise<ScratchDb> {
  const name = `t-${randomBytes(6).toString("hex")}`;
  const out = await dbWorktree([name]);
  const ownerUrl = /^MIGRATOR_DATABASE_URL=(.+)$/m.exec(out)?.[1];
  if (!ownerUrl) {
    throw new Error("db-worktree printed no MIGRATOR_DATABASE_URL for the scratch database");
  }
  const owner = createDb(ownerUrl, { max: 2 });
  return {
    owner,
    drop: async () => {
      await owner.destroy();
      await dbWorktree([name, "--drop"]);
    },
  };
}
