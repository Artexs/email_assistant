import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import { sendBase, toSendRow, type SendRow } from "./sends";
import type { DbOrTrx } from "./shared";

// F102 ticket: the sends that the approvals page lists. `awaiting_approval` sends (state `waiting`) and `approved` sends that
// no run holds (state `held`: `locked_at` null or before `staleBefore`, as `setRejected` decides). Newest first.
export async function listApprovalSends(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { staleBefore: Date; limit: number }
): Promise<SendRow[]> {
  const rows = await sendBase(db, ctx)
    .where((eb) =>
      eb.or([
        eb("actions.status", "=", "awaiting_approval"),
        eb.and([
          eb("actions.status", "=", "approved"),
          eb.or([eb("actions.locked_at", "is", null), eb("actions.locked_at", "<", opts.staleBefore)]),
        ]),
      ])
    )
    .orderBy("actions.created_at", "desc")
    .orderBy("actions.id", "desc")
    .limit(opts.limit)
    .execute();
  return rows.map(toSendRow);
}

// F102 ticket (nav badge): the sends that wait for approval and whose draft is `applied` (the card has gone out, or goes out next).
export async function countWaitingApprovals(db: DbOrTrx, ctx: TenantContext): Promise<number> {
  const row = await db
    .selectFrom("actions")
    .innerJoin("actions as draft", (join) =>
      join.onRef("draft.id", "=", "actions.depends_on_action_id").onRef("draft.org_id", "=", "actions.org_id")
    )
    .select(sql<string>`count(*)`.as("count"))
    .where("actions.org_id", "=", ctx.orgId)
    .where("draft.org_id", "=", ctx.orgId)
    .where("actions.type", "=", "send")
    .where("actions.status", "=", "awaiting_approval")
    .where("draft.status", "=", "applied")
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
