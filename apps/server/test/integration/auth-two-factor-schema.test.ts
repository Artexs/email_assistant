import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { insertMembership, insertOrganization, insertUser } from "../../src/modules/tenancy/repo";
import type { DB, Db } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

async function newUser(trx: Db | Transaction<DB>) {
  return insertUser(trx, { email: `u-${randomUUID()}@x.test`, displayName: "U" });
}

async function newOrg(trx: Db | Transaction<DB>) {
  return insertOrganization(trx, { name: `Org ${randomUUID()}`, timezone: "Europe/Warsaw" });
}

// A statement that must fail aborts the transaction: run it in a savepoint and roll back to it.
async function expectViolation(trx: Transaction<DB>, code: string, run: () => Promise<unknown>) {
  await sql`savepoint violation_probe`.execute(trx);
  await expect(run()).rejects.toMatchObject({ code });
  await sql`rollback to savepoint violation_probe`.execute(trx);
}

function markBreakGlass(trx: Transaction<DB>, orgId: string, userId: string) {
  return trx
    .updateTable("memberships")
    .set({ break_glass: true })
    .where("org_id", "=", orgId)
    .where("user_id", "=", userId)
    .execute();
}

describe("two_factor migration: auth_two_factors and users.two_factor_enabled", () => {
  test("a new user has two_factor_enabled = false", async () => {
    await withRollback(db, async (trx) => {
      const user = await newUser(trx);
      const row = await trx
        .selectFrom("users")
        .select("two_factor_enabled")
        .where("id", "=", user.id)
        .executeTakeFirstOrThrow();
      expect(row.two_factor_enabled).toBe(false);
    });
  });

  test("an auth_two_factors row gets its defaults", async () => {
    await withRollback(db, async (trx) => {
      const user = await newUser(trx);
      const row = await trx
        .insertInto("auth_two_factors")
        .values({ user_id: user.id, secret: "s", backup_codes: "b" })
        .returningAll()
        .executeTakeFirstOrThrow();
      expect(row.verified).toBe(false);
      expect(row.failed_verification_count).toBe(0);
      expect(row.locked_until).toBeNull();
      expect(row.created_at).toBeInstanceOf(Date);
    });
  });

  test("a second auth_two_factors row for one user is a unique violation", async () => {
    await withRollback(db, async (trx) => {
      const user = await newUser(trx);
      await trx.insertInto("auth_two_factors").values({ user_id: user.id, secret: "s", backup_codes: "b" }).execute();
      await expectViolation(trx, "23505", () =>
        trx.insertInto("auth_two_factors").values({ user_id: user.id, secret: "s2", backup_codes: "b2" }).execute()
      );
    });
  });

  test("failed_verification_count cannot be negative", async () => {
    await withRollback(db, async (trx) => {
      const user = await newUser(trx);
      await expectViolation(trx, "23514", () =>
        trx
          .insertInto("auth_two_factors")
          .values({ user_id: user.id, secret: "s", backup_codes: "b", failed_verification_count: -1 })
          .execute()
      );
    });
  });

  test("deleting a user deletes its auth_two_factors row", async () => {
    await withRollback(db, async (trx) => {
      const user = await newUser(trx);
      await trx.insertInto("auth_two_factors").values({ user_id: user.id, secret: "s", backup_codes: "b" }).execute();
      await trx.deleteFrom("users").where("id", "=", user.id).execute();
      const left = await trx.selectFrom("auth_two_factors").select("id").where("user_id", "=", user.id).execute();
      expect(left).toHaveLength(0);
    });
  });

  test("the app role can insert, select, update and delete auth_two_factors", async () => {
    const user = await newUser(db);
    try {
      await db.insertInto("auth_two_factors").values({ user_id: user.id, secret: "s", backup_codes: "b" }).execute();
      const row = await db
        .selectFrom("auth_two_factors")
        .selectAll()
        .where("user_id", "=", user.id)
        .executeTakeFirstOrThrow();
      expect(row.secret).toBe("s");
      await db.updateTable("auth_two_factors").set({ verified: true }).where("user_id", "=", user.id).execute();
      const updated = await db
        .selectFrom("auth_two_factors")
        .select("verified")
        .where("user_id", "=", user.id)
        .executeTakeFirstOrThrow();
      expect(updated.verified).toBe(true);
      await db.deleteFrom("auth_two_factors").where("user_id", "=", user.id).execute();
      const left = await db.selectFrom("auth_two_factors").select("id").where("user_id", "=", user.id).execute();
      expect(left).toHaveLength(0);
    } finally {
      await db.deleteFrom("users").where("id", "=", user.id).execute();
    }
  });
});

describe("two_factor migration: memberships.break_glass", () => {
  test("only an owner membership can be the break-glass one", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const user = await newUser(trx);
      await insertMembership(trx, { orgId: org.id }, { userId: user.id, role: "assistant" });
      await expectViolation(trx, "23514", () => markBreakGlass(trx, org.id, user.id));
      await expectViolation(trx, "23514", () =>
        trx
          .insertInto("memberships")
          .values({ org_id: org.id, user_id: user.id, role: "assistant", break_glass: true })
          .execute()
      );
    });
  });

  test("one break-glass owner per organization; the same user can be one in a second organization", async () => {
    await withRollback(db, async (trx) => {
      const orgA = await newOrg(trx);
      const orgB = await newOrg(trx);
      const first = await newUser(trx);
      const second = await newUser(trx);
      await insertMembership(trx, { orgId: orgA.id }, { userId: first.id, role: "owner" });
      await insertMembership(trx, { orgId: orgA.id }, { userId: second.id, role: "owner" });
      await insertMembership(trx, { orgId: orgB.id }, { userId: first.id, role: "owner" });
      await markBreakGlass(trx, orgA.id, first.id);
      await expectViolation(trx, "23505", () => markBreakGlass(trx, orgA.id, second.id));
      await markBreakGlass(trx, orgB.id, first.id);
    });
  });

  test("a new membership has break_glass = false", async () => {
    await withRollback(db, async (trx) => {
      const org = await newOrg(trx);
      const user = await newUser(trx);
      await insertMembership(trx, { orgId: org.id }, { userId: user.id, role: "owner" });
      const row = await trx
        .selectFrom("memberships")
        .select("break_glass")
        .where("org_id", "=", org.id)
        .where("user_id", "=", user.id)
        .executeTakeFirstOrThrow();
      expect(row.break_glass).toBe(false);
    });
  });
});
