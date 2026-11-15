import type { Transaction } from "kysely";

import type { DB, Db } from "../../../platform/db";

export interface SsoProviderRow {
  orgId: string;
  domain: string;
  issuer: string;
}

// No TenantContext: the IdP gives the provider id (the organization id as text). The callback runs inside `/api/auth/*`
// with no tenant scope, so RLS shows every row (like `isBreakGlassOwner`). Reads only.
export async function getSsoProviderByProviderId(
  db: Db | Transaction<DB>,
  providerId: string
): Promise<SsoProviderRow | undefined> {
  const row = await db
    .selectFrom("sso_providers")
    .select(["org_id", "domain", "issuer"])
    .where("provider_id", "=", providerId)
    .executeTakeFirst();
  return row ? { orgId: row.org_id, domain: row.domain, issuer: row.issuer } : undefined;
}

// The user that this IdP subject is linked to (`auth_accounts`: provider id and subject), or undefined.
export async function getSsoLinkUserId(
  db: Db | Transaction<DB>,
  providerId: string,
  subject: string
): Promise<string | undefined> {
  const row = await db
    .selectFrom("auth_accounts")
    .select("user_id")
    .where("provider_id", "=", providerId)
    .where("account_id", "=", subject)
    .executeTakeFirst();
  return row?.user_id;
}

// True when the user already has a link of this provider to another IdP subject (one user, one SSO identity).
export async function hasOtherSsoAccount(
  db: Db | Transaction<DB>,
  userId: string,
  providerId: string,
  subject: string
): Promise<boolean> {
  const row = await db
    .selectFrom("auth_accounts")
    .select("id")
    .where("user_id", "=", userId)
    .where("provider_id", "=", providerId)
    .where("account_id", "<>", subject)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

// `users.email` is stored in lower case (CHECK); the caller lower-cases the IdP address.
export async function getUserIdByEmail(db: Db | Transaction<DB>, email: string): Promise<string | undefined> {
  const row = await db.selectFrom("users").select("id").where("email", "=", email).executeTakeFirst();
  return row?.id;
}

// True when the user belongs to an organization with `sso_required` and is not its break-glass owner with TOTP on
// (the user's own `two_factor_enabled`). One such organization is enough: a user in two organizations is refused.
// No TenantContext: the user gives the rows; RLS shows every row inside `/api/auth/*` (like `isBreakGlassOwner`).
// The flag `sso_sign_in` is not read: switching it off does not reopen passwords (only the operator does).
export async function isPasswordSignInRefused(db: Db | Transaction<DB>, userId: string): Promise<boolean> {
  const row = await db
    .selectFrom("memberships")
    .innerJoin("organizations", "organizations.id", "memberships.org_id")
    .innerJoin("users", "users.id", "memberships.user_id")
    .select("memberships.user_id")
    .where("memberships.user_id", "=", userId)
    .where("organizations.sso_required", "=", true)
    .where((eb) =>
      eb.not(eb.and([eb("memberships.break_glass", "=", true), eb("users.two_factor_enabled", "=", true)]))
    )
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}
