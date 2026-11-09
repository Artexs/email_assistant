import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

async function expectCode(
  trx: Transaction<DB>,
  name: string,
  run: () => Promise<unknown>,
  code: string,
  constraint?: string
) {
  await sql`savepoint ${sql.id(name)}`.execute(trx);
  await expect(run()).rejects.toMatchObject(constraint ? { code, constraint } : { code });
  await sql`rollback to savepoint ${sql.id(name)}`.execute(trx);
}

async function insertUser(trx: Transaction<DB>, email: string): Promise<string> {
  const row = await trx
    .insertInto("users")
    .values({ email, display_name: "T" })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function insertSession(trx: Transaction<DB>, userId: string, token: string) {
  await sql`INSERT INTO auth_sessions (user_id, token, expires_at) VALUES (${userId}, ${token}, now() + interval '1 day')`.execute(
    trx
  );
}

async function insertAccount(trx: Transaction<DB>, userId: string, providerId: string, accountId: string) {
  await sql`INSERT INTO auth_accounts (user_id, provider_id, account_id, password) VALUES (${userId}, ${providerId}, ${accountId}, 'x')`.execute(
    trx
  );
}

async function countRows(trx: Transaction<DB>, table: string, userId: string): Promise<number> {
  const result = await sql<{
    n: number;
  }>`SELECT count(*)::int AS n FROM ${sql.id(table)} WHERE user_id = ${userId}`.execute(trx);
  return result.rows[0]?.n ?? 0;
}

describe("S5a schema: users", () => {
  test("e-mail stays lower-case; the new columns have defaults", async () => {
    await withRollback(db, async (trx) => {
      await expectCode(
        trx,
        "mixed_case",
        () => insertUser(trx, "Mixed.Case@X.test"),
        "23514",
        "users_email_lower_check"
      );
      const id = await insertUser(trx, "mixed.case@x.test");
      const result = await sql<{ email_verified: boolean; image: string | null; recent: boolean }>`
        SELECT email_verified, image, abs(extract(epoch FROM (now() - updated_at))) < 5 AS recent
        FROM users WHERE id = ${id}`.execute(trx);
      expect(result.rows[0]).toEqual({ email_verified: true, image: null, recent: true });
    });
  });
});

describe("S5a schema: auth tables", () => {
  test("auth_sessions: unique token, cascade on user delete", async () => {
    await withRollback(db, async (trx) => {
      const userId = await insertUser(trx, "mixed.case@x.test");
      await insertSession(trx, userId, "t1");
      await expectCode(trx, "dup_token", () => insertSession(trx, userId, "t1"), "23505");
      expect(await countRows(trx, "auth_sessions", userId)).toBe(1);
      await trx.deleteFrom("users").where("id", "=", userId).execute();
      expect(await countRows(trx, "auth_sessions", userId)).toBe(0);
    });
  });

  test("auth_accounts: unique provider and account, two providers, cascade", async () => {
    await withRollback(db, async (trx) => {
      const userId = await insertUser(trx, "mixed.case@x.test");
      await insertAccount(trx, userId, "credential", userId);
      await expectCode(trx, "dup_account", () => insertAccount(trx, userId, "credential", userId), "23505");
      await insertAccount(trx, userId, "google", "123");
      expect(await countRows(trx, "auth_accounts", userId)).toBe(2);
      await trx.deleteFrom("users").where("id", "=", userId).execute();
      expect(await countRows(trx, "auth_accounts", userId)).toBe(0);
    });
  });

  test("auth_verifications: insert, select, update and delete work for the app role", async () => {
    await withRollback(db, async (trx) => {
      const userId = await insertUser(trx, "mixed.case@x.test");
      await sql`INSERT INTO auth_verifications (identifier, value, expires_at)
        VALUES ('reset-password:abc', ${userId}, now() + interval '1 hour')`.execute(trx);
      const found = await sql<{ value: string }>`
        SELECT value FROM auth_verifications WHERE identifier = 'reset-password:abc'`.execute(trx);
      expect(found.rows.map((row) => row.value)).toEqual([userId]);
      await sql`UPDATE auth_verifications SET value = 'changed' WHERE identifier = 'reset-password:abc'`.execute(trx);
      const updated = await sql<{ value: string }>`
        SELECT value FROM auth_verifications WHERE identifier = 'reset-password:abc'`.execute(trx);
      expect(updated.rows[0]?.value).toBe("changed");
      await sql`DELETE FROM auth_verifications WHERE identifier = 'reset-password:abc'`.execute(trx);
      const gone = await sql`SELECT 1 FROM auth_verifications WHERE identifier = 'reset-password:abc'`.execute(trx);
      expect(gone.rows).toHaveLength(0);
    });
  });

  test("indexes and the e-mail check exist", async () => {
    await withRollback(db, async (trx) => {
      const indexes = await sql<{ indexname: string }>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND indexname IN (
          'auth_sessions_user_id_idx', 'auth_accounts_user_id_idx',
          'auth_verifications_identifier_idx', 'auth_verifications_expires_at_idx')
        ORDER BY indexname`.execute(trx);
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        "auth_accounts_user_id_idx",
        "auth_sessions_user_id_idx",
        "auth_verifications_expires_at_idx",
        "auth_verifications_identifier_idx",
      ]);
      const checks = await sql<{ conname: string }>`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'users'::regclass AND conname = 'users_email_lower_check'`.execute(trx);
      expect(checks.rows).toHaveLength(1);
    });
  });
});
