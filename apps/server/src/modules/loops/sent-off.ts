import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { expireSend, noDelegationHooks } from "../actions";
import { mailboxHasUidplus } from "../mail";

import { closeLoop, SYSTEM } from "./repo";
import { clearedTexts } from "./retention";

// The hook of `setSentSync` (`SentSwitchHooks.onDisabled`). Turning off "Track my sent mail" closes every open loop of
// the mailbox as `sent_off` and clears its texts at once. A closed loop stays as it is (retention clears it later). One
// audit row per closed loop. Returns the number closed.
// A follow-up of the mailbox that waits for a tap, or is approved and not yet claimed, ends `expired` / `loop_closed`
// (`expireWaitingFollowUps`).
export async function onSentOff(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: { mailboxId: string; at: Date }
): Promise<number> {
  const { mailboxId, at } = input;
  const open = await trx
    .selectFrom("open_loops")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("status", "=", "open")
    .orderBy("id")
    .forUpdate()
    .execute();
  const closed: string[] = [];
  for (const { id } of open) {
    if ((await closeLoop(trx, ctx, { loopId: id, reason: "sent_off", at })) === "closed") closed.push(id);
  }
  if (closed.length > 0) {
    await trx
      .updateTable("open_loops")
      .set(clearedTexts(at))
      .where("org_id", "=", ctx.orgId)
      .where("id", "in", closed)
      .execute();
  }
  await expireWaitingFollowUps(trx, ctx, mailboxId, at);
  return closed.length;
}

// Every follow-up send of the mailbox that has not started. The loops are locked before. A send that the committer
// holds (`applying`, or `approved` with a fresh claim) finishes: `expireSend` refuses it.
async function expireWaitingFollowUps(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  at: Date
): Promise<void> {
  const sends = await trx
    .selectFrom("actions")
    .innerJoin("open_loops", (join) =>
      join.onRef("open_loops.id", "=", "actions.loop_id").onRef("open_loops.org_id", "=", "actions.org_id")
    )
    .select("actions.id")
    .where("actions.org_id", "=", ctx.orgId)
    .where("open_loops.org_id", "=", ctx.orgId)
    .where("open_loops.mailbox_id", "=", mailboxId)
    .where("actions.type", "=", "send")
    .where("actions.status", "in", ["awaiting_approval", "approved"])
    .orderBy("actions.id")
    .execute();
  if (sends.length === 0) return;
  const uidplus = await mailboxHasUidplus(trx, ctx, mailboxId);
  for (const { id } of sends) {
    await expireSend(trx, ctx, id, {
      reason: "loop_closed",
      now: at,
      actor: SYSTEM,
      hooks: noDelegationHooks,
      uidplus,
    });
  }
}
