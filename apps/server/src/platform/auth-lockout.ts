import { sql } from "kysely";

import type { Db } from "./db";

// L12: a fixed window. The 10th failure inside 15 minutes locks the user for 15 minutes.
export const LOCKOUT_MAX_FAILURES = 10;
export const LOCKOUT_WINDOW_MS = 15 * 60_000;
export const LOCKOUT_MS = 15 * 60_000;
export const LOCKOUT_MAILS_PER_DAY = 3;

export interface LockoutStore {
  isLocked(userId: string, now: Date): Promise<boolean>;
  /** Non-null only for the failure that locked the user. */
  recordFailure(userId: string, now: Date): Promise<{ lockedUntil: Date } | null>;
  recordSuccess(userId: string, now: Date): Promise<void>;
  /** After a successful password reset. */
  clear(userId: string, now: Date): Promise<void>;
  /** True = this lock may send a mail (at most 3 per UTC day). */
  claimMail(userId: string, now: Date): Promise<boolean>;
}

// User-scoped: the user gives the row (docs/code-patterns.md § Data access). Each step is one SQL statement.
export function createLockoutStore(db: Db): LockoutStore {
  return {
    async isLocked(userId, now) {
      const result = await sql<{ locked_until: Date | null }>`
        SELECT locked_until FROM auth_lockouts WHERE user_id = ${userId}
      `.execute(db);
      const lockedUntil = result.rows[0]?.locked_until;
      return lockedUntil != null && lockedUntil.getTime() > now.getTime();
    },

    async recordFailure(userId, now) {
      const windowStart = new Date(now.getTime() - LOCKOUT_WINDOW_MS);
      const counted = await sql<{ failed_count: number }>`
        INSERT INTO auth_lockouts (user_id, window_started_at, failed_count, updated_at)
        VALUES (${userId}, ${now}, 1, ${now})
        ON CONFLICT (user_id) DO UPDATE SET
          failed_count = CASE WHEN auth_lockouts.window_started_at <= ${windowStart} THEN 1 ELSE auth_lockouts.failed_count + 1 END,
          window_started_at = CASE WHEN auth_lockouts.window_started_at <= ${windowStart} THEN ${now} ELSE auth_lockouts.window_started_at END,
          updated_at = ${now}
        RETURNING failed_count
      `.execute(db);
      const failedCount = counted.rows[0]?.failed_count ?? 0;
      if (failedCount < LOCKOUT_MAX_FAILURES) return null;
      // A conditional update: of two parallel 10th failures, one gets the row.
      const lockedUntil = new Date(now.getTime() + LOCKOUT_MS);
      const locked = await sql<{ locked_until: Date }>`
        UPDATE auth_lockouts SET locked_until = ${lockedUntil}, failed_count = 0, window_started_at = ${now}, updated_at = ${now}
        WHERE user_id = ${userId} AND failed_count >= ${LOCKOUT_MAX_FAILURES}
        RETURNING locked_until
      `.execute(db);
      return locked.rows.length > 0 ? { lockedUntil } : null;
    },

    async recordSuccess(userId, now) {
      await sql`
        UPDATE auth_lockouts SET failed_count = 0, updated_at = ${now}
        WHERE user_id = ${userId} AND failed_count > 0
      `.execute(db);
    },

    async clear(userId, now) {
      await sql`
        UPDATE auth_lockouts SET failed_count = 0, locked_until = NULL, updated_at = ${now}
        WHERE user_id = ${userId}
      `.execute(db);
    },

    async claimMail(userId, now) {
      const day = now.toISOString().slice(0, 10);
      const result = await sql<{ mail_count: number }>`
        UPDATE auth_lockouts SET
          mail_count = CASE WHEN mail_day = ${day}::date THEN mail_count + 1 ELSE 1 END,
          mail_day = ${day}::date,
          updated_at = ${now}
        WHERE user_id = ${userId} AND (mail_day IS DISTINCT FROM ${day}::date OR mail_count < ${LOCKOUT_MAILS_PER_DAY})
        RETURNING mail_count
      `.execute(db);
      return result.rows.length > 0;
    },
  };
}
