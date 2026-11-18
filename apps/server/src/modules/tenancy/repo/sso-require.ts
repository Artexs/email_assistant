import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../../platform/db";

// The writes and reads of the domain proof and of the "SSO required" switch. Every call names the
// organization: the operator CLI runs with no tenant scope. The caller holds the organization lock and runs one transaction.

// The proof columns go together (CHECK). Only a row without a proof changes, so a second writer changes nothing.
export async function setDomainProof(
  trx: Transaction<DB>,
  ctx: TenantContext,
  proof: "dns" | "attested",
  now: Date
): Promise<void> {
  await trx
    .updateTable("sso_providers")
    .set({ domain_verified: true, domain_proof: proof, updated_at: now })
    .where("org_id", "=", ctx.orgId)
    .where("domain_proof", "is", null)
    .execute();
}

export async function readSsoRequired(trx: Transaction<DB>, ctx: TenantContext): Promise<boolean | undefined> {
  const row = await trx
    .selectFrom("organizations")
    .select("sso_required")
    .where("id", "=", ctx.orgId)
    .executeTakeFirst();
  return row?.sso_required;
}

export async function setSsoRequiredFlag(trx: Transaction<DB>, ctx: TenantContext, required: boolean): Promise<void> {
  await trx.updateTable("organizations").set({ sso_required: required }).where("id", "=", ctx.orgId).execute();
}

// True when a break-glass owner of the organization has TOTP on and keeps a password path after the switch. A password path
// stays only if no OTHER organization of that user requires SSO: `isPasswordSignInRefused` refuses a user for any
// organization where the user is not the break-glass owner with TOTP on (`two_factor_enabled` is on in the outer query).
export async function hasUsableBreakGlass(trx: Transaction<DB>, ctx: TenantContext): Promise<boolean> {
  const row = await trx
    .selectFrom("memberships")
    .innerJoin("users", "users.id", "memberships.user_id")
    .select("memberships.user_id")
    .where("memberships.org_id", "=", ctx.orgId)
    .where("memberships.break_glass", "=", true)
    .where("users.two_factor_enabled", "=", true)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("memberships as other")
            .innerJoin("organizations as other_org", "other_org.id", "other.org_id")
            .select("other.user_id")
            .whereRef("other.user_id", "=", "memberships.user_id")
            .where("other.org_id", "<>", ctx.orgId)
            .where("other_org.sso_required", "=", true)
            .where("other.break_glass", "=", false)
        )
      )
    )
    .executeTakeFirst();
  return row !== undefined;
}

// True when this switch would refuse the break-glass owner (TOTP on) of ANOTHER organization that already requires SSO:
// the user is a plain member here. That organization would lose its password path.
export async function strandsOtherBreakGlass(trx: Transaction<DB>, ctx: TenantContext): Promise<boolean> {
  const row = await trx
    .selectFrom("memberships as other")
    .innerJoin("organizations as other_org", "other_org.id", "other.org_id")
    .innerJoin("users", "users.id", "other.user_id")
    .innerJoin("memberships as here", "here.user_id", "other.user_id")
    .select("other.user_id")
    .where("other.org_id", "<>", ctx.orgId)
    .where("other.break_glass", "=", true)
    .where("other_org.sso_required", "=", true)
    .where("users.two_factor_enabled", "=", true)
    .where("here.org_id", "=", ctx.orgId)
    .where("here.break_glass", "=", false)
    .executeTakeFirst();
  return row !== undefined;
}

// The number of organizations that require SSO. No TenantContext: the start-up check counts all organizations (`listOrganizations`).
export async function countSsoRequiredOrgs(db: Db | Transaction<DB>): Promise<number> {
  const row = await db
    .selectFrom("organizations")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("sso_required", "=", true)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}
