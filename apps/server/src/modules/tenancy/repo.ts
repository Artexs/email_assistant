import {
  isFeatureKey,
  membershipRoleSchema,
  orgPlanSchema,
  userLocaleSchema,
  type FeatureKey,
  type MembershipRole,
  type OrgPlan,
  type UserLocale,
} from "@ea/core";
import { sql, type Selectable, type Transaction } from "kysely";

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
  break_glass: boolean;
}

export interface OrgPlanState {
  plan: OrgPlan;
  trialEndsAt: Date | null;
  maxMailboxes: number;
  resumedAt: Date | null;
}

export interface UserMembership {
  org_id: string;
  role: MembershipRole;
  created_at: Date;
}

// No TenantContext: the user gives the tenant (the web resolves the organization from the session, S5a).
export async function listMembershipsOfUser(db: Db | Transaction<DB>, userId: string): Promise<UserMembership[]> {
  const rows = await db
    .selectFrom("memberships")
    .select(["org_id", "role", "created_at"])
    .where("user_id", "=", userId)
    .orderBy("created_at")
    .orderBy("org_id")
    .execute();
  return rows.map((row) => ({ ...row, role: membershipRoleSchema.parse(row.role) }));
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
      "memberships.break_glass",
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
      "memberships.break_glass",
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

// Users are global (they join organizations through memberships), so it takes no TenantContext.
export async function insertUser(
  db: Db | Transaction<DB>,
  input: { email: string; displayName: string; locale?: UserLocale }
): Promise<{ id: string }> {
  return db
    .insertInto("users")
    .values({
      email: input.email,
      display_name: input.displayName,
      ...(input.locale ? { locale: input.locale } : {}),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
}

export interface UserAuthProfile {
  locale: UserLocale | null;
  termsVersion: string | null;
  termsAcceptedAt: Date | null;
  // users.two_factor_enabled: a Better Auth column read by our SQL (F105 D11).
  twoFactorEnabled: boolean;
}

// No TenantContext: the user gives the row; the web resolves the user from the session (S6b).
export async function getUserAuthProfile(
  db: Db | Transaction<DB>,
  userId: string
): Promise<UserAuthProfile | undefined> {
  const row = await db
    .selectFrom("users")
    .select(["locale", "terms_version", "terms_accepted_at", "two_factor_enabled"])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (!row) {
    return undefined;
  }
  return {
    locale: userLocaleSchema.nullable().parse(row.locale),
    termsVersion: row.terms_version,
    termsAcceptedAt: row.terms_accepted_at,
    twoFactorEnabled: row.two_factor_enabled,
  };
}

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

// No TenantContext: the user gives the row. True when the row changed; false for an unknown user or when the version is already stored.
export async function setUserTerms(
  db: Db | Transaction<DB>,
  userId: string,
  version: string,
  at: Date
): Promise<boolean> {
  const result = await db
    .updateTable("users")
    .set({ terms_version: version, terms_accepted_at: at })
    .where("id", "=", userId)
    .where(sql<boolean>`terms_version IS DISTINCT FROM ${version}`)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}

export async function setDigestTimes(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  userId: string,
  times: readonly string[]
): Promise<boolean> {
  const result = await db
    .updateTable("memberships")
    .set({ digest_times: [...times] })
    .where("org_id", "=", ctx.orgId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// Feature flags (ADR 0027). A missing row means the registry default: the caller decides (resolveFeature).
export async function getOrgFeature(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  flag: FeatureKey
): Promise<boolean | undefined> {
  const row = await db
    .selectFrom("org_features")
    .select("enabled")
    .where("org_id", "=", ctx.orgId)
    .where("flag", "=", flag)
    .executeTakeFirst();
  return row?.enabled;
}

export async function listOrgFeatureRows(
  db: Db | Transaction<DB>,
  ctx: TenantContext
): Promise<{ flag: string; enabled: boolean; set_by: string; set_at: Date }[]> {
  return db
    .selectFrom("org_features")
    .select(["flag", "enabled", "set_by", "set_at"])
    .where("org_id", "=", ctx.orgId)
    .orderBy("flag")
    .execute();
}

export async function upsertOrgFeature(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  input: { flag: FeatureKey; enabled: boolean; setBy: string; setAt: Date }
): Promise<void> {
  // The type is no guard at run time: a cast can pass any string.
  if (!isFeatureKey(input.flag)) throw new Error(`unknown feature flag: ${input.flag}`);
  await db
    .insertInto("org_features")
    .values({ org_id: ctx.orgId, flag: input.flag, enabled: input.enabled, set_by: input.setBy, set_at: input.setAt })
    .onConflict((oc) =>
      oc.columns(["org_id", "flag"]).doUpdateSet({ enabled: input.enabled, set_by: input.setBy, set_at: input.setAt })
    )
    .execute();
}

// No TenantContext: listed in docs/code-patterns.md. Only /api/operator/* calls it (F087).
export async function listOrgFeatureRowsOfAll(
  db: Db | Transaction<DB>
): Promise<{ org_id: string; flag: string; enabled: boolean }[]> {
  return db
    .selectFrom("org_features")
    .select(["org_id", "flag", "enabled"])
    .orderBy("org_id")
    .orderBy("flag")
    .execute();
}

// No TenantContext: the user gives the row. False for an unknown user.
export async function setUserLocale(db: Db | Transaction<DB>, userId: string, locale: UserLocale): Promise<boolean> {
  const result = await db.updateTable("users").set({ locale }).where("id", "=", userId).executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}
