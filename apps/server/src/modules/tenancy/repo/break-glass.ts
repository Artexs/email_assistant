import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../../platform/db";

// The break-glass owner of the organization (F105 D11), or null. The partial unique index allows at most one.
export async function getBreakGlassUserId(db: Db | Transaction<DB>, ctx: TenantContext): Promise<string | null> {
  const row = await db
    .selectFrom("memberships")
    .select("user_id")
    .where("org_id", "=", ctx.orgId)
    .where("break_glass", "=", true)
    .executeTakeFirst();
  return row?.user_id ?? null;
}

// True when a row changed. Turn the old mark off before the new one on: the partial unique index allows one per organization.
export async function setBreakGlassFlag(
  trx: Transaction<DB>,
  ctx: TenantContext,
  userId: string,
  on: boolean
): Promise<boolean> {
  const result = await trx
    .updateTable("memberships")
    .set({ break_glass: on })
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .where("break_glass", "=", !on)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}

// No TenantContext: the user gives the rows. True when any membership of the user has the mark.
// RLS (F105 F13): it reads the memberships of every organization, so call it only with no tenant scope
// (`/api/auth/*`, a CLI, a job). Inside an `/api` request RLS limits it to the session's organization.
export async function isBreakGlassOwner(db: Db | Transaction<DB>, userId: string): Promise<boolean> {
  const row = await db
    .selectFrom("memberships")
    .select("user_id")
    .where("user_id", "=", userId)
    .where("break_glass", "=", true)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

// No TenantContext: the user gives the rows. The ids of the organizations where the user holds the mark.
// RLS (F105 F13): like isBreakGlassOwner, call it only with no tenant scope (a CLI, a job).
export async function listBreakGlassOrgIdsOfUser(db: Db | Transaction<DB>, userId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("memberships")
    .select("org_id")
    .where("user_id", "=", userId)
    .where("break_glass", "=", true)
    .orderBy("org_id")
    .execute();
  return rows.map((row) => row.org_id);
}
