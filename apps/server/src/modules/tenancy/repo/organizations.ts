import { orgPlanSchema, type OrgPlan } from "@ea/core";
import type { Selectable, Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../../platform/db";

export type OrganizationRow = Selectable<DB["organizations"]>;

export interface OrgPlanState {
  plan: OrgPlan;
  trialEndsAt: Date | null;
  maxMailboxes: number;
  resumedAt: Date | null;
}

export async function getOrganization(
  db: Db | Transaction<DB>,
  ctx: TenantContext
): Promise<OrganizationRow | undefined> {
  return db.selectFrom("organizations").selectAll().where("id", "=", ctx.orgId).executeTakeFirst();
}

export async function getOrgPlan(db: Db | Transaction<DB>, ctx: TenantContext): Promise<OrgPlanState | undefined> {
  const row = await db
    .selectFrom("organizations")
    .select(["plan", "trial_ends_at", "max_mailboxes", "resumed_at"])
    .where("id", "=", ctx.orgId)
    .executeTakeFirst();
  return row ? planStateOfRow(row) : undefined;
}

// A missing organization gives false: the callers already answer not_found for it.
export async function isOrgSuspended(db: Db | Transaction<DB>, ctx: TenantContext): Promise<boolean> {
  const row = await db.selectFrom("organizations").select("plan").where("id", "=", ctx.orgId).executeTakeFirst();
  return row?.plan === "suspended";
}

// No TenantContext: the retention job, the operator job and `org:status` walk all organizations.
export async function listOrganizations(db: Db | Transaction<DB>): Promise<
  {
    id: string;
    plan: OrgPlan;
    trialEndsAt: Date | null;
    timezone: string;
    dataRetentionDays: number;
    resumedAt: Date | null;
  }[]
> {
  const rows = await db
    .selectFrom("organizations")
    .select(["id", "plan", "trial_ends_at", "timezone", "data_retention_days", "resumed_at"])
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({
    id: row.id,
    plan: orgPlanSchema.parse(row.plan),
    trialEndsAt: row.trial_ends_at,
    timezone: row.timezone,
    dataRetentionDays: row.data_retention_days,
    resumedAt: row.resumed_at,
  }));
}

export function planStateOfRow(
  row: Pick<OrganizationRow, "plan" | "trial_ends_at" | "max_mailboxes" | "resumed_at">
): OrgPlanState {
  return {
    plan: orgPlanSchema.parse(row.plan),
    trialEndsAt: row.trial_ends_at,
    maxMailboxes: row.max_mailboxes,
    resumedAt: row.resumed_at,
  };
}

export async function updateOrganizationPlan(
  trx: Transaction<DB>,
  ctx: TenantContext,
  patch: { plan: OrgPlan; trialEndsAt: Date | null; maxMailboxes: number; resumedAt: Date | null }
): Promise<OrganizationRow | undefined> {
  return trx
    .updateTable("organizations")
    .set({
      plan: patch.plan,
      trial_ends_at: patch.trialEndsAt,
      max_mailboxes: patch.maxMailboxes,
      resumed_at: patch.resumedAt,
    })
    .where("id", "=", ctx.orgId)
    .returningAll()
    .executeTakeFirst();
}

// FOR NO KEY UPDATE: a plain FOR UPDATE would block the foreign-key checks of the organization's child rows.
export async function lockOrganization(trx: Transaction<DB>, ctx: TenantContext): Promise<OrganizationRow | undefined> {
  return trx.selectFrom("organizations").selectAll().where("id", "=", ctx.orgId).forNoKeyUpdate().executeTakeFirst();
}

export async function updateOrganization(
  trx: Transaction<DB>,
  ctx: TenantContext,
  patch: { timezone?: string; styleText?: string | null }
): Promise<OrganizationRow | undefined> {
  return trx
    .updateTable("organizations")
    .set({
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      ...(patch.styleText !== undefined ? { style_text: patch.styleText } : {}),
    })
    .where("id", "=", ctx.orgId)
    .returningAll()
    .executeTakeFirst();
}

// Creates the tenant itself, so it takes no TenantContext.
export async function insertOrganization(
  db: Db | Transaction<DB>,
  input: { name: string; timezone: string; plan?: OrgPlan; trialEndsAt?: Date | null }
): Promise<{ id: string }> {
  return db
    .insertInto("organizations")
    .values({
      name: input.name,
      timezone: input.timezone,
      ...(input.plan !== undefined ? { plan: input.plan } : {}),
      ...(input.trialEndsAt !== undefined ? { trial_ends_at: input.trialEndsAt } : {}),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
}
