import { effectiveDetail, type NoticeDetail } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { isFeatureOn, listTelegramDetailsOf } from "../tenancy";

// Telegram detail level at send time (ADR 0032 point 5): the flag `telegram_minimal` of the organization, the lock of the
// organization and the level of the member decide, as `effectiveDetail` says. One reader serves the queue, the direct answers and the tap
// edits (`detailsOf`); the sender uses a gate that reads a whole claimed batch at once.

// A member that has no membership row (a link that outlived it) reads `minimal`: the safe level.
const MISSING_MEMBER: NoticeDetail = "minimal";

/** The effective level of each user of one organization, by user id: one flag read and, when the flag is on, one query. */
export async function detailsOf(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  userIds: readonly string[]
): Promise<Map<string, NoticeDetail>> {
  const levels = new Map<string, NoticeDetail>();
  if (userIds.length === 0) return levels;
  if (!(await isFeatureOn(db, ctx, "telegram_minimal"))) {
    for (const userId of userIds) levels.set(userId, "full");
    return levels;
  }
  const rows = await listTelegramDetailsOf(
    db,
    userIds.map((userId) => ({ orgId: ctx.orgId, userId }))
  );
  for (const userId of userIds) {
    const row = rows.get(`${ctx.orgId}:${userId}`);
    levels.set(
      userId,
      row === undefined
        ? MISSING_MEMBER
        : effectiveDetail({ flagOn: true, locked: row.locked, memberDetail: row.memberDetail })
    );
  }
  return levels;
}

/** The effective level of one user. */
export async function detailOfUser(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  userId: string
): Promise<NoticeDetail> {
  return (await detailsOf(db, ctx, [userId])).get(userId) ?? MISSING_MEMBER;
}

export interface DetailGate {
  /** The effective level of the user of a claimed row. The flag is read once per organization and the members once per batch. */
  detailOf(row: { orgId: string; userId: string }): Promise<NoticeDetail>;
}

// The detail levels of one claimed batch. Like the quiet gate: the flag per organization is cached, and the members of all
// claimed rows are read once, on the first row that needs a level.
export function createDetailGate(deps: {
  db: Db | Transaction<DB>;
  claimed: readonly { orgId: string; userId: string }[];
}): DetailGate {
  const { db } = deps;
  const flagged = new Map<string, boolean>();
  let members: Awaited<ReturnType<typeof listTelegramDetailsOf>> | undefined;

  return {
    async detailOf(row) {
      let on = flagged.get(row.orgId);
      if (on === undefined) {
        on = await isFeatureOn(db, { orgId: row.orgId }, "telegram_minimal");
        flagged.set(row.orgId, on);
      }
      if (!on) return "full";
      members ??= await listTelegramDetailsOf(db, deps.claimed);
      const member = members.get(`${row.orgId}:${row.userId}`);
      if (member === undefined) return MISSING_MEMBER;
      return effectiveDetail({ flagOn: true, locked: member.locked, memberDetail: member.memberDetail });
    },
  };
}
