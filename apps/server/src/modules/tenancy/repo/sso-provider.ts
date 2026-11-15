import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../../platform/db";

// The write side of the provider table (F119 stage 07). Reads and writes name the organization: the operator CLI runs with
// no tenant scope, so RLS would show every row.

export interface SsoProviderFull {
  providerId: string;
  issuer: string;
  domain: string;
  oidcConfig: string;
  domainProof: "dns" | "attested" | null;
}

function proofOf(value: string | null): "dns" | "attested" | null {
  return value === "dns" || value === "attested" ? value : null;
}

// FOR UPDATE: a callback in flight holds this row (the plugin locks it with an UPDATE) and finishes first (N7).
// The caller holds the organization lock already (`lockOrganization`): that lock first, then this one.
export async function lockSsoProvider(trx: Transaction<DB>, ctx: TenantContext): Promise<SsoProviderFull | undefined> {
  const row = await trx
    .selectFrom("sso_providers")
    .select(["provider_id", "issuer", "domain", "oidc_config", "domain_proof"])
    .where("org_id", "=", ctx.orgId)
    .forUpdate()
    .executeTakeFirst();
  return row
    ? {
        providerId: row.provider_id,
        issuer: row.issuer,
        domain: row.domain,
        oidcConfig: row.oidc_config,
        domainProof: proofOf(row.domain_proof),
      }
    : undefined;
}

// True when another organization holds the domain.
export async function isDomainTakenByOther(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  domain: string
): Promise<boolean> {
  const row = await db
    .selectFrom("sso_providers")
    .select("id")
    .where("domain", "=", domain)
    .where("org_id", "<>", ctx.orgId)
    .executeTakeFirst();
  return row !== undefined;
}

// The provider id is the organization id as text (stage 02).
export async function insertSsoProvider(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: { issuer: string; domain: string; oidcConfig: string; now: Date }
): Promise<void> {
  await trx
    .insertInto("sso_providers")
    .values({
      provider_id: ctx.orgId,
      org_id: ctx.orgId,
      issuer: input.issuer,
      domain: input.domain,
      oidc_config: input.oidcConfig,
      created_at: input.now,
      updated_at: input.now,
    })
    .execute();
}

// `boundary: true` also drops the proof (a new issuer, domain or client is a new identity provider).
export async function updateSsoProvider(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: { issuer: string; domain: string; oidcConfig: string; now: Date; boundary: boolean }
): Promise<void> {
  await trx
    .updateTable("sso_providers")
    .set({
      issuer: input.issuer,
      domain: input.domain,
      oidc_config: input.oidcConfig,
      updated_at: input.now,
      ...(input.boundary ? { domain_verified: false, domain_proof: null } : {}),
    })
    .where("org_id", "=", ctx.orgId)
    .execute();
}

export async function deleteSsoProvider(trx: Transaction<DB>, ctx: TenantContext): Promise<void> {
  await trx.deleteFrom("sso_providers").where("org_id", "=", ctx.orgId).execute();
}

export async function clearSsoRequired(trx: Transaction<DB>, ctx: TenantContext): Promise<void> {
  await trx.updateTable("organizations").set({ sso_required: false }).where("id", "=", ctx.orgId).execute();
}

export interface SsoStateRow {
  providerId: string;
  issuer: string;
  domain: string;
  proof: "dns" | "attested" | null;
  required: boolean;
  linkedMembers: number;
  breakGlassReady: boolean;
}

// Never the config. `linkedMembers` counts `auth_accounts` rows of the provider; `breakGlassReady` is true when the
// break-glass owner has TOTP on.
export async function readSsoState(db: Db | Transaction<DB>, ctx: TenantContext): Promise<SsoStateRow | undefined> {
  const provider = await db
    .selectFrom("sso_providers")
    .innerJoin("organizations", "organizations.id", "sso_providers.org_id")
    .select([
      "sso_providers.provider_id",
      "sso_providers.issuer",
      "sso_providers.domain",
      "sso_providers.domain_proof",
      "organizations.sso_required",
    ])
    .where("sso_providers.org_id", "=", ctx.orgId)
    .executeTakeFirst();
  if (!provider) return undefined;
  const linked = await db
    .selectFrom("auth_accounts")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("provider_id", "=", provider.provider_id)
    .executeTakeFirstOrThrow();
  const ready = await db
    .selectFrom("memberships")
    .innerJoin("users", "users.id", "memberships.user_id")
    .select("memberships.user_id")
    .where("memberships.org_id", "=", ctx.orgId)
    .where("memberships.break_glass", "=", true)
    .where("users.two_factor_enabled", "=", true)
    .executeTakeFirst();
  return {
    providerId: provider.provider_id,
    issuer: provider.issuer,
    domain: provider.domain,
    proof: proofOf(provider.domain_proof),
    required: provider.sso_required,
    linkedMembers: Number(linked.n),
    breakGlassReady: ready !== undefined,
  };
}
