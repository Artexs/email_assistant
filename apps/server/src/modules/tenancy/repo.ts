import { membershipRoleSchema, type MembershipRole } from "@ea/core";
import type { Selectable, Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

export type OrganizationRow = Selectable<DB["organizations"]>;

export interface MembershipWithUser {
  org_id: string;
  user_id: string;
  role: MembershipRole;
  digest_times: string[];
  created_at: Date;
  email: string;
  display_name: string;
}

export async function getOrganization(
  db: Db | Transaction<DB>,
  ctx: TenantContext
): Promise<OrganizationRow | undefined> {
  return db.selectFrom("organizations").selectAll().where("id", "=", ctx.orgId).executeTakeFirst();
}

export async function listMemberships(db: Db | Transaction<DB>, ctx: TenantContext): Promise<MembershipWithUser[]> {
  const rows = await db
    .selectFrom("memberships")
    .innerJoin("users", "users.id", "memberships.user_id")
    .select([
      "memberships.org_id",
      "memberships.user_id",
      "memberships.role",
      "memberships.digest_times",
      "memberships.created_at",
      "users.email",
      "users.display_name",
    ])
    .where("memberships.org_id", "=", ctx.orgId)
    .orderBy("memberships.created_at")
    .orderBy("users.email")
    .execute();
  return rows.map((row) => ({ ...row, role: membershipRoleSchema.parse(row.role) }));
}

export async function getMembership(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  userId: string
): Promise<MembershipWithUser | undefined> {
  const row = await db
    .selectFrom("memberships")
    .innerJoin("users", "users.id", "memberships.user_id")
    .select([
      "memberships.org_id",
      "memberships.user_id",
      "memberships.role",
      "memberships.digest_times",
      "memberships.created_at",
      "users.email",
      "users.display_name",
    ])
    .where("memberships.org_id", "=", ctx.orgId)
    .where("memberships.user_id", "=", userId)
    .executeTakeFirst();
  return row ? { ...row, role: membershipRoleSchema.parse(row.role) } : undefined;
}

export async function insertMembership(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { userId: string; role: MembershipRole }
): Promise<void> {
  await db.insertInto("memberships").values({ org_id: ctx.orgId, user_id: input.userId, role: input.role }).execute();
}

// Creates the tenant itself, so it takes no TenantContext.
export async function insertOrganization(
  db: Db | Transaction<DB>,
  input: { name: string; timezone: string }
): Promise<{ id: string }> {
  return db
    .insertInto("organizations")
    .values({ name: input.name, timezone: input.timezone })
    .returning("id")
    .executeTakeFirstOrThrow();
}

// Users are global (they join organizations through memberships), so it takes no TenantContext.
export async function insertUser(
  db: Db | Transaction<DB>,
  input: { email: string; displayName: string }
): Promise<{ id: string }> {
  return db
    .insertInto("users")
    .values({ email: input.email, display_name: input.displayName })
    .returning("id")
    .executeTakeFirstOrThrow();
}
