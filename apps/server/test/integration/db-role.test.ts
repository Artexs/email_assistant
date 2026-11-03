import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { assertAppRole, checkDb, createDb, DbRoleError } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";

const db = testDb();
const migratorUrl = process.env.MIGRATOR_DATABASE_URL;
if (!migratorUrl) {
  throw new Error("MIGRATOR_DATABASE_URL is missing: the integration tests need it");
}
const migratorDb = createDb(migratorUrl);
const unreachableDb = createDb("postgres://app:wrong@127.0.0.1:1/none");
// A local listener that accepts TCP connections and never answers: only the pool connection timeout ends the wait.
const silentServer = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open: () => undefined,
    data: () => undefined,
  },
});
const silentDb = createDb(`postgres://app:x@127.0.0.1:${silentServer.port}/none`);

afterAll(async () => {
  silentServer.stop(true);
  await Promise.all([db.destroy(), migratorDb.destroy(), unreachableDb.destroy(), silentDb.destroy()]);
});

describe("db role", () => {
  test("assertAppRole resolves for the app role", async () => {
    await expect(assertAppRole(db)).resolves.toBeUndefined();
  });

  test("the server connects as app", async () => {
    const result = await sql<{ role: string }>`select current_user as role`.execute(db);
    expect(result.rows[0]?.role).toBe("app");
  });

  test("assertAppRole rejects the migrator role", async () => {
    await expect(assertAppRole(migratorDb)).rejects.toBeInstanceOf(DbRoleError);
  });

  test("app has no DDL right", async () => {
    await withRollback(db, async (trx) => {
      await expect(sql`create table x (id int)`.execute(trx)).rejects.toThrow("permission denied for schema public");
    });
  });
});

describe("checkDb", () => {
  test("is true when the DB answers", async () => {
    expect(await checkDb(db)).toBe(true);
  });

  test("is false when the DB does not answer", async () => {
    expect(await checkDb(unreachableDb)).toBe(false);
  });

  test("is false within 7 s when the DB accepts the connection and never answers", async () => {
    const started = Date.now();
    expect(await checkDb(silentDb)).toBe(false);
    expect(Date.now() - started).toBeLessThan(7000);
  }, 10_000);
});
