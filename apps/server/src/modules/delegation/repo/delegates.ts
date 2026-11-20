import { normalizeAddress } from "@ea/core";
import type { Transaction } from "kysely";

import { normalizedAddress, type DB, type TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

export interface DelegateRow {
  id: string;
  name: string;
  email: string;
  competence_tags: string[];
  active: boolean;
  created_at: Date;
  updated_at: Date;
}
// The delegate of the organization whose address is the same person by the one address rule (`normalizeAddress`), in any
// status. The stored form keeps today's lower case; both sides fold here.
export async function findDelegateIdByAddress(
  db: DbOrTrx,
  ctx: TenantContext,
  address: string
): Promise<string | undefined> {
  const row = await db
    .selectFrom("delegates")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where(normalizedAddress("email"), "=", normalizeAddress(address))
    .orderBy("created_at")
    .orderBy("id")
    .limit(1)
    .executeTakeFirst();
  return row?.id;
}

// null = the email exists in this organization (the unique index on org_id and email).
export async function insertDelegate(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { name: string; email: string; tags: string[] }
): Promise<string | null> {
  const row = await db
    .insertInto("delegates")
    .values({ org_id: ctx.orgId, name: input.name, email: input.email, competence_tags: input.tags })
    .onConflict((oc) => oc.columns(["org_id", "email"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  return row?.id ?? null;
}
// Name, id order. `activeFirst` puts the active delegates first (the panel list); `limit` caps the rows.
export async function listDelegates(
  db: DbOrTrx,
  ctx: TenantContext,
  opts?: { activeOnly?: boolean; activeFirst?: boolean; limit?: number }
): Promise<DelegateRow[]> {
  return db
    .selectFrom("delegates")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .$if(opts?.activeOnly === true, (qb) => qb.where("active", "=", true))
    .$if(opts?.activeFirst === true, (qb) => qb.orderBy("active", "desc"))
    .orderBy("name")
    .orderBy("id")
    .$if(opts?.limit !== undefined, (qb) => qb.limit(opts?.limit ?? 0))
    .execute();
}
export async function getDelegate(db: DbOrTrx, ctx: TenantContext, id: string): Promise<DelegateRow | undefined> {
  return db.selectFrom("delegates").selectAll().where("org_id", "=", ctx.orgId).where("id", "=", id).executeTakeFirst();
}
// The row locked for the rest of the transaction: two changes of one delegate run one after the other, so each sees the other's result.
export async function lockDelegate(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string
): Promise<DelegateRow | undefined> {
  return trx
    .selectFrom("delegates")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
}
// The address never changes: the patch has no `email`.
export async function updateDelegateFields(
  trx: Transaction<DB>,
  ctx: TenantContext,
  id: string,
  patch: { name?: string; tags?: string[]; active?: boolean },
  at: Date
): Promise<void> {
  await trx
    .updateTable("delegates")
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.tags === undefined ? {} : { competence_tags: patch.tags }),
      ...(patch.active === undefined ? {} : { active: patch.active }),
      updated_at: at,
    })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .execute();
}
export async function listDelegateNames(
  db: DbOrTrx,
  ctx: TenantContext,
  ids: readonly string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom("delegates")
    .select(["id", "name"])
    .where("org_id", "=", ctx.orgId)
    .where("id", "in", [...ids])
    .execute();
  return new Map(rows.map((row) => [row.id, row.name]));
}
// The competence tags of delegates: words the organization wrote, never mail text.
export async function listDelegateTags(
  db: DbOrTrx,
  ctx: TenantContext,
  ids: readonly string[]
): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom("delegates")
    .select(["id", "competence_tags"])
    .where("org_id", "=", ctx.orgId)
    .where("id", "in", [...ids])
    .execute();
  return new Map(rows.map((row) => [row.id, row.competence_tags]));
}
// For `isExternalSender`. Lower case by the column check.
export async function listDelegateAddresses(
  db: DbOrTrx,
  ctx: TenantContext,
  opts?: { activeOnly?: boolean }
): Promise<string[]> {
  const rows = await db
    .selectFrom("delegates")
    .select("email")
    .where("org_id", "=", ctx.orgId)
    .$if(opts?.activeOnly === true, (qb) => qb.where("active", "=", true))
    .orderBy("email")
    .execute();
  return rows.map((row) => row.email);
}
