import { describe, expect, test } from "bun:test";
import { sql, type Kysely } from "kysely";

import { createDb, withoutTenantScope, withTenantScope, type Db, type DB } from "../../src/platform/db";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

// A fresh session returns NULL and a session after a driver write returns '': both mean "no scope" (D15 rule 2).
const setting = async (executor: Kysely<DB>): Promise<string> => {
  const result = await sql<{ s: string }>`select coalesce(current_setting('app.org_id', true), '') as s`.execute(
    executor
  );
  return result.rows[0]?.s ?? "";
};

const withDb = async (max: number, fn: (db: Db) => Promise<void>): Promise<void> => {
  const db = createDb(process.env.DATABASE_URL ?? "", { max });
  try {
    await fn(db);
  } finally {
    await db.destroy();
  }
};

describe("db tenant scope", () => {
  test("a scoped query reads its scope and the next unscoped query resets it", () =>
    withDb(1, async (db) => {
      expect(await withTenantScope(A, () => setting(db))).toBe(A);
      expect(await setting(db)).toBe("");
    }));

  test("a transaction runs with the scope of its chain", () =>
    withDb(1, async (db) => {
      const seen = await withTenantScope(A, () => db.transaction().execute((trx) => setting(trx)));
      expect(seen).toBe(A);
    }));

  test("a transaction on a held connection runs with the scope", () =>
    withDb(1, async (db) => {
      const seen = await withTenantScope(B, () =>
        db.connection().execute((conn) => conn.transaction().execute((trx) => setting(trx)))
      );
      expect(seen).toBe(B);
    }));

  test("withoutTenantScope inside a scope reads no scope", () =>
    withDb(1, async (db) => {
      const seen = await withTenantScope(A, () => withoutTenantScope(() => setting(db)));
      expect(seen).toBe("");
    }));

  test("a busy pool gives each waiting chain its own scope", () =>
    withDb(1, async (db) => {
      const result = await Promise.all([
        withTenantScope(A, async () => {
          await sql`select pg_sleep(0.05)`.execute(db);
          return setting(db);
        }),
        withTenantScope(B, () => setting(db)),
      ]);
      expect(result).toEqual([A, B]);
    }));

  for (const scopes of [
    [A, B, null],
    [null, A, B],
  ] as const) {
    test(`30 parallel calls on 2 connections never read a foreign scope (${scopes.map((s) => (s ? s[0] : "none")).join(",")})`, () =>
      withDb(2, async (db) => {
        const results = await Promise.all(
          Array.from({ length: 30 }, (_, i) => {
            const scope = scopes[i % 3] ?? null;
            const run = async (): Promise<{ want: string; got: string }> => ({
              want: scope ?? "",
              got: await setting(db),
            });
            return scope === null ? withoutTenantScope(run) : withTenantScope(scope, run);
          })
        );
        expect(results.filter((r) => r.want !== r.got)).toEqual([]);
      }));
  }

  test("a rolled back transaction keeps the scope outside the transaction", () =>
    withDb(1, async (db) => {
      await withTenantScope(A, async () => {
        await expect(
          db.transaction().execute(async () => {
            throw new Error("abort");
          })
        ).rejects.toThrow("abort");
        expect(await setting(db)).toBe(A);
      });
      expect(await setting(db)).toBe("");
    }));

  test("a builder query goes through the driver", () =>
    withDb(1, async (db) => {
      await withTenantScope(A, () => db.selectFrom("organizations").select("id").limit(1).execute());
      expect(await setting(db)).toBe("");
    }));

  test("the second query of a chain that waited for the pool keeps its scope", () =>
    withDb(1, async (db) => {
      const result = await Promise.all([
        withTenantScope(B, async () => {
          await sql`select pg_sleep(0.05)`.execute(db);
          return setting(db);
        }),
        withTenantScope(A, async () => {
          const first = await setting(db);
          const second = await setting(db);
          return [first, second];
        }),
      ]);
      expect(result).toEqual([B, [A, A]]);
    }));
});
