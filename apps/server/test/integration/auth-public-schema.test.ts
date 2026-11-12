import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { insertUser } from "../../src/modules/tenancy";
import type { DB, Db } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";

const db = testDb();
const windowStart = new Date("2026-11-20T10:00:00Z");

afterAll(async () => {
  await db.destroy();
});

async function newUser(trx: Db | Transaction<DB>) {
  return insertUser(trx, { email: `u-${randomUUID()}@x.test`, displayName: "U" });
}

// A statement that must fail aborts the transaction: run it in a savepoint and roll back to it.
async function expectCheckViolation(trx: Transaction<DB>, run: () => Promise<unknown>) {
  await sql`savepoint check_probe`.execute(trx);
  await expect(run()).rejects.toMatchObject({ code: "23514" });
  await sql`rollback to savepoint check_probe`.execute(trx);
}

describe("auth_public migration", () => {
  test("users.locale accepts only pl and en", async () => {
    await withRollback(db, async (trx) => {
      const user = await newUser(trx);
      await expectCheckViolation(trx, () =>
        trx.updateTable("users").set({ locale: "de" }).where("id", "=", user.id).execute()
      );
      await trx.updateTable("users").set({ locale: "pl" }).where("id", "=", user.id).execute();
    });
  });

  test("terms_version and terms_accepted_at are set together", async () => {
    await withRollback(db, async (trx) => {
      const user = await newUser(trx);
      await expectCheckViolation(trx, () =>
        trx.updateTable("users").set({ terms_version: "2026-11-12" }).where("id", "=", user.id).execute()
      );
      await trx
        .updateTable("users")
        .set({ terms_version: "2026-11-12", terms_accepted_at: windowStart })
        .where("id", "=", user.id)
        .execute();
    });
  });

  test("deleting a user deletes its auth_lockouts row", async () => {
    const user = await newUser(db);
    try {
      await db.insertInto("auth_lockouts").values({ user_id: user.id, window_started_at: windowStart }).execute();
      await db.deleteFrom("users").where("id", "=", user.id).execute();
      const row = await db
        .selectFrom("auth_lockouts")
        .select(sql<number>`count(*)::int`.as("n"))
        .where("user_id", "=", user.id)
        .executeTakeFirstOrThrow();
      expect(row.n).toBe(0);
    } finally {
      await db.deleteFrom("users").where("id", "=", user.id).execute();
    }
  });

  test("auth_lockouts counters cannot be negative", async () => {
    await withRollback(db, async (trx) => {
      const user = await newUser(trx);
      await expectCheckViolation(trx, () =>
        trx
          .insertInto("auth_lockouts")
          .values({ user_id: user.id, window_started_at: windowStart, failed_count: -1 })
          .execute()
      );
      await expectCheckViolation(trx, () =>
        trx
          .insertInto("auth_lockouts")
          .values({ user_id: user.id, window_started_at: windowStart, mail_count: -1 })
          .execute()
      );
    });
  });

  test("the app role can insert, select, update and delete auth_lockouts", async () => {
    const user = await newUser(db);
    try {
      await db.insertInto("auth_lockouts").values({ user_id: user.id, window_started_at: windowStart }).execute();
      const row = await db
        .selectFrom("auth_lockouts")
        .selectAll()
        .where("user_id", "=", user.id)
        .executeTakeFirstOrThrow();
      expect(row.failed_count).toBe(0);
      await db.updateTable("auth_lockouts").set({ failed_count: 3 }).where("user_id", "=", user.id).execute();
      const updated = await db
        .selectFrom("auth_lockouts")
        .select("failed_count")
        .where("user_id", "=", user.id)
        .executeTakeFirstOrThrow();
      expect(updated.failed_count).toBe(3);
      await db.deleteFrom("auth_lockouts").where("user_id", "=", user.id).execute();
      const left = await db.selectFrom("auth_lockouts").select("user_id").where("user_id", "=", user.id).execute();
      expect(left).toHaveLength(0);
    } finally {
      await db.deleteFrom("users").where("id", "=", user.id).execute();
    }
  });
});
