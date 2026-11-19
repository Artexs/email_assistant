import type { RemoveAccessPage, UserLocale } from "@ea/core";
import { type Transaction } from "kysely";

import { type DB, type TenantContext } from "../../../platform/db";
import { isFeatureOn } from "../../tenancy";
import { queueNotice } from "../notice-queue";
import { listPushOnlyMembers } from "../push";
import { listLinkedChatsOfOrg } from "../repo";

// Every owner hears that a mailbox was removed: an owner with a linked chat, and (flag `web_push` on) an owner with a live device and no chat. No mailbox or email id: those rows are gone, and the text holds no address.
// `access` (an OAuth mailbox) is set here because the mailbox row is gone when the notice renders.
export async function queueMailboxRemovedNotices(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: { mailboxId: string; now: Date; access?: { page: RemoveAccessPage; revoked: boolean | null } }
): Promise<number> {
  let queued = 0;
  const owners: { userId: string; locale: UserLocale }[] = (await listLinkedChatsOfOrg(trx, ctx)).filter(
    (chat) => chat.role === "owner"
  );
  if (await isFeatureOn(trx, ctx, "web_push")) {
    const pushOnly = await listPushOnlyMembers(trx, { now: input.now, orgId: ctx.orgId });
    owners.push(...pushOnly.filter((member) => member.role === "owner"));
  }
  for (const owner of owners) {
    const id = await queueNotice(trx, ctx, {
      userId: owner.userId,
      locale: owner.locale,
      kind: "mailbox_removed",
      dedupKey: `mailbox_removed:${input.mailboxId}`,
      view: input.access === undefined ? {} : { access: input.access },
      eventAt: input.now,
      now: input.now,
    });
    if (id !== null) queued += 1;
  }
  return queued;
}
