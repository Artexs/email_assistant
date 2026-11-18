import type { Transaction } from "kysely";

import type { DB } from "./db";

// Kysely only, no better-auth import. The third place where our SQL touches the Better Auth tables
// (docs/code-patterns.md § Data access), next to `auth-two-factor-reset.ts`.
// The caller owns the transaction: the deletes commit or roll back with the caller's other writes.

// Removes every link of one SSO provider (`auth_accounts` rows with this provider id) and the SSO sessions of the linked
// users. A password session of such a user stays. The sessions go first, because the users come from the links.
export async function endSsoLinksAndSessions(
  trx: Transaction<DB>,
  providerId: string
): Promise<{ linksRemoved: number; sessionsEnded: number }> {
  const links = await trx.selectFrom("auth_accounts").select("user_id").where("provider_id", "=", providerId).execute();
  const userIds = [...new Set(links.map((link) => link.user_id))];
  let sessionsEnded = 0;
  if (userIds.length > 0) {
    const sessions = await trx
      .deleteFrom("auth_sessions")
      .where("user_id", "in", userIds)
      .where("sign_in_method", "=", "sso")
      .executeTakeFirst();
    sessionsEnded = Number(sessions.numDeletedRows);
  }
  const removed = await trx.deleteFrom("auth_accounts").where("provider_id", "=", providerId).executeTakeFirst();
  return { linksRemoved: Number(removed.numDeletedRows), sessionsEnded };
}

// Ends every password session of the users and every open verification row whose value is the user id:
// "SSO required" went on for them. A pending two-factor challenge lives 600 s: its cookie plus `/two-factor/verify-totp`
// would still make a password session after the switch. Better Auth stores the identifiers hashed, so the user id in
// `value` is the only link to the challenge (like `resetTwoFactorRows`). The same rows hold the trusted devices and the open
// reset links of the user: a refused member needs none of them. The counter row of a challenge (value: a count) has no
// user id; it ends by its own 600 s expiry and cannot open a session. An SSO session stays.
export async function endPasswordSessionsAndChallenges(
  trx: Transaction<DB>,
  userIds: readonly string[]
): Promise<{ sessionsEnded: number; challengesEnded: number }> {
  if (userIds.length === 0) return { sessionsEnded: 0, challengesEnded: 0 };
  const sessions = await trx
    .deleteFrom("auth_sessions")
    .where("user_id", "in", [...userIds])
    .where("sign_in_method", "=", "password")
    .executeTakeFirst();
  const verifications = await trx
    .deleteFrom("auth_verifications")
    .where("value", "in", [...userIds])
    .executeTakeFirst();
  return { sessionsEnded: Number(sessions.numDeletedRows), challengesEnded: Number(verifications.numDeletedRows) };
}

// Ends the sessions of one user: all of them, or only the SSO ones. Returns the count. The caller has checked
// that the user belongs to the organization of the operator's request. Sessions belong to the user, not to the organization:
// a user with a membership in two organizations loses the sessions in both, and `onlySso` ends the SSO sessions of every
// provider of the user.
export async function endUserSessions(trx: Transaction<DB>, userId: string, onlySso: boolean): Promise<number> {
  let query = trx.deleteFrom("auth_sessions").where("user_id", "=", userId);
  if (onlySso) query = query.where("sign_in_method", "=", "sso");
  const result = await query.executeTakeFirst();
  return Number(result.numDeletedRows);
}

// Removes the link of one user to one SSO provider and, when a link existed, the SSO sessions of the user. A password session
// stays. Without a link nothing changes: no SSO session can exist without one (the provider removal ends both together).
export async function unlinkSsoAccount(
  trx: Transaction<DB>,
  userId: string,
  providerId: string
): Promise<{ linkRemoved: boolean; sessionsEnded: number }> {
  const removed = await trx
    .deleteFrom("auth_accounts")
    .where("user_id", "=", userId)
    .where("provider_id", "=", providerId)
    .executeTakeFirst();
  if (Number(removed.numDeletedRows) === 0) return { linkRemoved: false, sessionsEnded: 0 };
  return { linkRemoved: true, sessionsEnded: await endUserSessions(trx, userId, true) };
}
