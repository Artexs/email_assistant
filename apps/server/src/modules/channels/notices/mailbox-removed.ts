import { type Transaction } from "kysely";

import { type DB, type TenantContext } from "../../../platform/db";
import { queueNotice } from "../notice-queue";
import { listLinkedChatsOfOrg } from "../repo";

// D11: every owner hears that a mailbox was removed. No mailbox or email id: those rows are gone, and the text holds no address.
export async function queueMailboxRemovedNotices(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: { mailboxId: string; now: Date }
): Promise<number> {
  let queued = 0;
  for (const chat of await listLinkedChatsOfOrg(trx, ctx)) {
    if (chat.role !== "owner") continue;
    const id = await queueNotice(trx, ctx, {
      userId: chat.userId,
      locale: chat.locale,
      kind: "mailbox_removed",
      dedupKey: `mailbox_removed:${input.mailboxId}`,
      view: {},
      now: input.now,
    });
    if (id !== null) queued += 1;
  }
  return queued;
}
