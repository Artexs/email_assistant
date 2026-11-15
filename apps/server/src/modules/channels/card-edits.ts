import type { HeldBy } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { getOrganization } from "../tenancy";

import { failPendingCardsOfSend, listCardsOfSend } from "./card-edits-repo";
import { queueNotice } from "./notice-queue";

export type CardEditOutcome = "approved" | "approved_held" | "rejected" | "changed" | "expired";

// `approved_held` names why the send waits (`heldBy`); no other outcome has it. The compiler refuses the held outcome
// without it (at run time the view would not render, and the decision transaction would roll back).
export type CardEdit =
  | { outcome: "approved_held"; heldBy: HeldBy }
  | { outcome: Exclude<CardEditOutcome, "approved_held">; heldBy?: never };

export interface CardEditResult {
  // Rows queued now (a repeated outcome queues none: its dedup key exists).
  queued: number;
  // Cards that were still `pending`: they never go out, because the send has an answer.
  cancelled: number;
}

// F102 stage 06 (D4): after a decision on a send, every owner's sent card of that send shows the result and loses its
// buttons. Runs in the transaction of the decision. One `approval_edit` row per card and outcome; the sender (stage 09) edits
// the Telegram message. `sendId` is the send that the card asks about. `exceptUserId` is the user whose own tap edits the
// card in place. A card of a reminder set (`approval_set:`) gets no edit (Q15).
//   `sent` card with its text and message id → one row (`approval_edit:<card id>:<outcome>`)
//   `pending` card → `failed` / `answered_elsewhere` (nobody saw it; the send is decided)
//   `sending` card → nothing: it is in flight, and a tap on it answers by the state (accepted race)
export async function queueCardEdits(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: CardEdit & {
    sendId: string;
    exceptUserId?: string;
    at: Date;
  }
): Promise<CardEditResult> {
  const organization = await getOrganization(trx, ctx);
  if (organization === undefined) throw new Error("organization not found");
  let queued = 0;
  for (const card of await listCardsOfSend(trx, ctx, input.sendId)) {
    if (card.userId === input.exceptUserId) continue;
    const { text, externalMessageId, emailId } = card;
    if (card.status !== "sent" || !text || externalMessageId === null || emailId === null) continue;
    const id = await queueNotice(trx, ctx, {
      userId: card.userId,
      locale: card.locale,
      kind: "approval_edit",
      dedupKey: `approval_edit:${card.id}:${input.outcome}`,
      emailId,
      editOfOutboxId: card.id,
      view: {
        original: text,
        outcome: input.outcome,
        at: input.at,
        timeZone: organization.timezone,
        ...(input.heldBy === undefined ? {} : { heldBy: input.heldBy }),
        // The Reject button of the held card names the send (Q13).
        ...(input.outcome === "approved_held" ? { actionId: input.sendId } : {}),
      },
      now: input.at,
    });
    if (id !== null) queued += 1;
  }
  return { queued, cancelled: await failPendingCardsOfSend(trx, ctx, input.sendId) };
}
