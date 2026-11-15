import { userLocaleSchema, type UserLocale } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, Db } from "../../../platform/db";

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

// A user with no password and a verified address, for an SSO member (F119 stage 10). `ON CONFLICT` on the unique index
// `lower(email)`: two operators who add the same address in two organizations at once get one row and one `undefined`
// (one user, one organization). The caller lower-cases the address.
export async function insertSsoUserOnce(
  trx: Transaction<DB>,
  input: { email: string; displayName: string; locale: UserLocale }
): Promise<{ id: string } | undefined> {
  return trx
    .insertInto("users")
    .values({ email: input.email, display_name: input.displayName, locale: input.locale, email_verified: true })
    .onConflict((oc) => oc.expression(sql`lower(email)`).doNothing())
    .returning("id")
    .executeTakeFirst();
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

// No TenantContext: the user gives the row. False for an unknown user.
export async function setUserLocale(db: Db | Transaction<DB>, userId: string, locale: UserLocale): Promise<boolean> {
  const result = await db.updateTable("users").set({ locale }).where("id", "=", userId).executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}
