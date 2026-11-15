import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../../platform/db";
import type { ActionAnchor } from "../anchor";

// The column of the anchor: `email_id` or `loop_id`, never both (the database CHECK says so too).
function anchorColumns(anchor: ActionAnchor): { email_id: string } | { loop_id: string } {
  return anchor.kind === "email" ? { email_id: anchor.emailId } : { loop_id: anchor.loopId };
}

// F102 ticket: the two rows of a panel edit. The new draft is `ready`, the new send `awaiting_approval`; each names the row it
// replaces (`supersedes_action_id`, the composite FK keeps it in the organization). The keys make a second insert a no-op.
// Null: the key exists (the caller holds the lock of the old send, so this means a crash left a row: nothing is written).
export async function insertEditedPair(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: {
    // The mail or the loop of the old pair: the new pair hangs on the same one.
    anchor: ActionAnchor;
    oldDraftId: string;
    oldSendId: string;
    draftPayload: Record<string, unknown>;
    sendPayload: Record<string, unknown>;
  }
): Promise<{ draftId: string; sendId: string } | null> {
  const draft = await trx
    .insertInto("actions")
    .values({
      org_id: ctx.orgId,
      ...anchorColumns(input.anchor),
      type: "create_draft",
      status: "ready",
      payload: JSON.stringify(input.draftPayload),
      idempotency_key: `${input.oldDraftId}:edit`,
      supersedes_action_id: input.oldDraftId,
    })
    .onConflict((oc) => oc.columns(["org_id", "idempotency_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  if (draft === undefined) return null;
  const send = await trx
    .insertInto("actions")
    .values({
      org_id: ctx.orgId,
      ...anchorColumns(input.anchor),
      type: "send",
      status: "awaiting_approval",
      payload: JSON.stringify(input.sendPayload),
      idempotency_key: `${input.oldSendId}:edit`,
      depends_on_action_id: draft.id,
      supersedes_action_id: input.oldSendId,
    })
    .onConflict((oc) => oc.columns(["org_id", "idempotency_key"]).doNothing())
    .returning("id")
    .executeTakeFirst();
  if (send === undefined) return null;
  return { draftId: draft.id, sendId: send.id };
}
