import type { RemoveAccessPage } from "@ea/core";
import { type Transaction } from "kysely";

import { type DB, type TenantContext } from "../../../platform/db";
import { queueNotice } from "../notice-queue";
import { listLinkedChatsOfOrg } from "../repo";

// Every owner hears that a mailbox was removed. No mailbox or email id: those rows are gone, and the text holds no address.
// `access` (an OAuth mailbox) is set here because the mailbox row is gone when the notice renders.
export async function queueMailboxRemovedNotices(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: { mailboxId: string; now: Date; access?: { page: RemoveAccessPage; revoked: boolean | null } }
): Promise<number> {
  let queued = 0;
  for (const chat of await listLinkedChatsOfOrg(trx, ctx)) {
    if (chat.role !== "owner") continue;
    const id = await queueNotice(trx, ctx, {
      userId: chat.userId,
      locale: chat.locale,
      kind: "mailbox_removed",
      dedupKey: `mailbox_removed:${input.mailboxId}`,
      view: input.access === undefined ? {} : { access: input.access },
      now: input.now,
    });
    if (id !== null) queued += 1;
  }
  return queued;
}
