import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { clearLoopSentCopies } from "../actions";

import { expireFollowUpSends } from "./follow-up-expiry";
import { closeLoop } from "./repo";
import { clearedTexts } from "./retention";

// The hook of `setSentSync` (`SentSwitchHooks.onDisabled`). Turning off "Track my sent mail" closes every open loop of
// the mailbox as `sent_off` and clears its texts at once. A closed loop stays as it is (retention clears it later). One
// audit row per closed loop. Returns the number closed.
// A follow-up of the mailbox that waits for a tap, or is approved and not yet claimed, ends `expired` / `loop_closed`
// (`expireFollowUpSends`). Then the copies of the Sent mail in the follow-up rows of every loop of the mailbox go too: the
// keys `quote`, `to`, `cc` and `subject` of `actions.payload` (`clearLoopSentCopies`). The cards of the follow-ups
// (`outbox.view`, `outbox.text`) are cleared by `clearLoopCards` of `channels`, which `composition.ts` runs after this hook,
// in the same transaction. The texts of a loop that was already closed stay until retention (the rule of `clearLoopTexts`).
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
  await expireFollowUpSends(trx, ctx, { mailboxId }, at);
  await clearLoopSentCopies(trx, ctx, { mailboxId });
  return closed.length;
}
