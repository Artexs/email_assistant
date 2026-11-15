import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../../platform/db";

// The writes and reads of the domain proof and of the "SSO required" switch (F119 stage 09). Every call names the
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

// True when a break-glass owner of the organization has TOTP on.
export async function hasBreakGlassWithTotp(trx: Transaction<DB>, ctx: TenantContext): Promise<boolean> {
  const row = await trx
    .selectFrom("memberships")
    .innerJoin("users", "users.id", "memberships.user_id")
    .select("memberships.user_id")
    .where("memberships.org_id", "=", ctx.orgId)
    .where("memberships.break_glass", "=", true)
    .where("users.two_factor_enabled", "=", true)
    .executeTakeFirst();
  return row !== undefined;
}
