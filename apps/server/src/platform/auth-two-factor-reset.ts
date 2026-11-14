import { sql, type Transaction } from "kysely";

import type { DB } from "./db";

// Kysely only, no better-auth import (F105 D4).
// The second place where our SQL touches the Better Auth tables (docs/code-patterns.md § Data access).
// The caller owns the transaction: every write below commits or rolls back with the caller's other writes.
export async function resetTwoFactorRows(
  trx: Transaction<DB>,
  userId: string
): Promise<{ hadTwoFactor: boolean; sessionsEnded: number }> {
  const rows = await trx.deleteFrom("auth_two_factors").where("user_id", "=", userId).executeTakeFirst();
  const flag = await trx
    .updateTable("users")
    .set({ two_factor_enabled: false })
    .where("id", "=", userId)
    .where("two_factor_enabled", "=", true)
    .executeTakeFirst();
  // Trusted devices (the `value` is the user id), open challenges and open reset links.
  await sql`DELETE FROM auth_verifications WHERE value = ${userId}`.execute(trx);
  const sessions = await trx.deleteFrom("auth_sessions").where("user_id", "=", userId).executeTakeFirst();
  return {
    hadTwoFactor: Number(rows.numDeletedRows) > 0 || Number(flag.numUpdatedRows) > 0,
    sessionsEnded: Number(sessions.numDeletedRows),
  };
}
