import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";

import { closeLoop } from "./repo";
import { clearedTexts } from "./retention";

// The hook of `setSentSync` (`SentSwitchHooks.onDisabled`). Turning off "Track my sent mail" closes every open loop of
// the mailbox as `sent_off` and clears its texts at once. A closed loop stays as it is (retention clears it later). One
// audit row per closed loop. Returns the number closed. The expiry of waiting follow-up drafts comes with the follow-up kind.
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
  return closed.length;
}
