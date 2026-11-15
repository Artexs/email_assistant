import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { expireSend, noDelegationHooks } from "../actions";
import { mailboxHasUidplus } from "../mail";

import { SYSTEM } from "./repo";

// The follow-up sends of a closed loop (`loopId`) or of every loop of a mailbox (`mailboxId`: the switch off) that have not
// started end `expired` / `loop_closed`. The caller holds the lock of the loop or loops: loop first, then sends. A send that
// the committer holds (`applying`, or `approved` with a fresh claim) finishes: `expireSend` refuses it. Returns the count.
export async function expireFollowUpSends(
  trx: Transaction<DB>,
  ctx: TenantContext,
  scope: { mailboxId: string; loopId?: string },
  at: Date
): Promise<number> {
  let query = trx
    .selectFrom("actions")
    .innerJoin("open_loops", (join) =>
      join.onRef("open_loops.id", "=", "actions.loop_id").onRef("open_loops.org_id", "=", "actions.org_id")
    )
    .select("actions.id")
    .where("actions.org_id", "=", ctx.orgId)
    .where("open_loops.org_id", "=", ctx.orgId)
    .where("open_loops.mailbox_id", "=", scope.mailboxId)
    .where("actions.type", "=", "send")
    .where("actions.status", "in", ["awaiting_approval", "approved"]);
  if (scope.loopId !== undefined) query = query.where("actions.loop_id", "=", scope.loopId);
  const sends = await query.orderBy("actions.id").execute();
  if (sends.length === 0) return 0;
  const uidplus = await mailboxHasUidplus(trx, ctx, scope.mailboxId);
  let expired = 0;
  for (const { id } of sends) {
    const done = await expireSend(trx, ctx, id, {
      reason: "loop_closed",
      now: at,
      actor: SYSTEM,
      hooks: noDelegationHooks,
      uidplus,
    });
    if (done) expired += 1;
  }
  return expired;
}
