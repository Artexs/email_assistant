import {
  draftPayloadSchema,
  hasGaps,
  sameAddresses,
  sendPayloadSchema,
  sendRecipients,
  type OutgoingMessage,
  type SendPayload,
} from "@ea/core";

import type { TenantContext } from "../../platform/db";

import type { ApplyDeps } from "./apply-shared";
import { buildDraftMessage, loopAnchorOf, recipientsFromLoop } from "./drafts";
import type { ClaimedAction, DraftRow } from "./repo";

export interface Prepared {
  draft: DraftRow;
  payload: SendPayload;
  message: OutgoingMessage;
}

// The send and the draft of a reply: the same kind, the same To and the same Cc (lower case, as a set).
function sameReplyRecipients(
  send: { kind: string; to: readonly string[]; cc?: readonly string[] | undefined },
  draft: { kind: string; to: readonly string[]; cc?: readonly string[] }
): boolean {
  return (
    send.kind === "reply" &&
    draft.kind === "reply" &&
    sameAddresses(send.to, draft.to) &&
    sameAddresses(send.cc ?? [], draft.cc ?? [])
  );
}

// The payloads, the draft and the message. The draft's id and `created_at` give the draft APPEND's Message-ID and Date.
// A follow-up is also checked against its loop: the send and the draft name the same loop, the send goes to nobody that the
// draft does not name, and nobody that the loop does not hold. `null`: the payload is bad.
export async function prepare(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  draft: DraftRow
): Promise<Prepared | null> {
  const payload = sendPayloadSchema.safeParse(action.payload);
  const draftPayload = draftPayloadSchema.safeParse(draft.payload);
  if (!payload.success || !draftPayload.success) return null;
  const followUp = draftPayload.data.kind === "follow_up" ? draftPayload.data : null;
  if (
    (followUp === null) !== (action.loop_id === null) ||
    (followUp === null) !== (payload.data.kind !== "follow_up")
  ) {
    return null;
  }
  // A reply is checked like a follow-up: the send and the draft are both replies and name the same To and Cc, because
  // the envelope reads the send and the message headers read the draft. A recipient that only the send names gets nothing.
  if (
    (payload.data.kind === "reply" || draftPayload.data.kind === "reply") &&
    !sameReplyRecipients(payload.data, draftPayload.data)
  ) {
    return null;
  }
  const anchor = await loopAnchorOf(deps, ctx, action);
  if (followUp !== null) {
    const drafted = new Set(sendRecipients(followUp).map((address) => address.toLowerCase()));
    const same =
      anchor !== undefined &&
      payload.data.loop_id === followUp.loop_id &&
      followUp.loop_id === action.loop_id &&
      draft.loop_id === action.loop_id &&
      sendRecipients(payload.data).every((address) => drafted.has(address.toLowerCase())) &&
      recipientsFromLoop(payload.data, anchor);
    if (!same) return null;
  }
  const message = buildDraftMessage(
    deps,
    { ...action, id: draft.id, created_at: draft.created_at, payload: draft.payload },
    anchor
  );
  return { draft, payload: payload.data, message };
}

// A reply whose effective text (`body_text ?? body`) holds a gap (`[[`) never goes out. The product cannot make such a send (the tap
// refuses it); this guards a hand edit of the database. The row ends `failed` / `has_gaps` before any SMTP call.
export function replyHasGaps(draft: DraftRow): boolean {
  const payload = draftPayloadSchema.safeParse(draft.payload);
  return payload.success && payload.data.kind === "reply" && hasGaps(payload.data.body_text ?? payload.data.body);
}
