import type { HeldBy } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { getSend, sendFilterFor, sendScopeAdmits, type SendScope } from "../actions";
import { getMailbox, mailboxStatusSchema } from "../mail";

export interface HeldReasonDeps {
  db: Db | Transaction<DB>;
  sendScope: SendScope;
}

// Why the committer will not claim the send just approved: the state of the mailbox first, then the scope (as /status).
// A send or mailbox that cannot be read counts as held by the scope: the answer must not promise a send.
// One check for the Telegram toast, the card edits of other channels and the panel (F102).
export async function heldReason(
  deps: HeldReasonDeps,
  ctx: TenantContext,
  sendId: string
): Promise<HeldBy | undefined> {
  const send = await getSend(deps.db, ctx, sendId);
  const mailbox = send === undefined ? undefined : await getMailbox(deps.db, ctx, send.email.mailbox_id);
  if (send === undefined || mailbox === undefined) return "scope";
  const to = Array.isArray(send.payload.to) ? send.payload.to.filter((item) => typeof item === "string") : [];
  switch (mailboxStatusSchema.parse(mailbox.status)) {
    case "paused":
      return "paused";
    case "auth_error":
      return "auth_error";
    case "host_blocked":
      return "host_blocked";
    case "active":
      return sendScopeAdmits(sendFilterFor(deps.sendScope), to) ? undefined : "scope";
  }
}
