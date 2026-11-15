import { textTables } from "@ea/core";
import type { Transaction } from "kysely";
import { z } from "zod";

import type { Db, TenantContext } from "../../platform/db";
import type { DB } from "../../platform/db";
import { getSend } from "../actions";

import { getEditTarget, newerEditSent, type EditTarget } from "./card-edits-repo";
import { OUTBOX_REMOVED_TEXT, type ClaimedOutbox } from "./repo";

export type EditCheck = { ok: true; target: EditTarget } | { ok: false; code: "stale_edit" | "no_target" };

const outcomeOf = z.object({
  original: z.string().optional(),
  outcome: z.enum(["approved", "approved_held", "rejected", "changed", "expired"]),
});

// Does the send still have the outcome that the edit shows? A tap, a decision in another channel or the expiry job can
// change the send between the queue and the sender run; the edit of an outcome that is gone would put a lie on the card.
function sendHas(
  outcome: z.infer<typeof outcomeOf>["outcome"],
  send: { status: string; status_reason: string | null }
): boolean {
  switch (outcome) {
    case "approved":
    case "approved_held":
      return send.status === "approved" || send.status === "applying" || send.status === "applied";
    case "rejected":
      return send.status === "rejected";
    case "changed":
      return send.status === "expired" && send.status_reason === "superseded";
    case "expired":
      return send.status === "expired";
  }
}

// The checks of one `approval_edit` row before the sender calls `channel.edit` (F102 card sync):
//   no card to edit (not sent, no message id, text removed by retention, another user's card) → `no_target`
//     (an edit whose original is our fixed text for a removed follow-up card needs no text of the card: the switch off blanked it)
//   the send has another outcome now, or a newer edit of the card went out                       → `stale_edit`
export async function checkCardEdit(db: Db | Transaction<DB>, row: ClaimedOutbox): Promise<EditCheck> {
  const ctx: TenantContext = { orgId: row.orgId };
  const outcome = outcomeOf.safeParse(row.view);
  if (row.editOfOutboxId === null || !outcome.success) return { ok: false, code: "no_target" };
  const target = await getEditTarget(db, ctx, { targetId: row.editOfOutboxId, userId: row.userId });
  if (target === undefined) return { ok: false, code: "no_target" };
  // The fixed text of any locale: the row's locale and the card owner's locale are the same today, but the check needs neither.
  const fixedText = Object.values(textTables).some(
    (texts) => texts.approvals.followUpRemoved === outcome.data.original
  );
  if (target.text === OUTBOX_REMOVED_TEXT && !fixedText) return { ok: false, code: "no_target" };
  const send = await getSend(db, ctx, target.sendId);
  if (send === undefined || !sendHas(outcome.data.outcome, send)) return { ok: false, code: "stale_edit" };
  if (await newerEditSent(db, ctx, { id: row.id, targetId: target.id, createdAt: row.createdAt })) {
    return { ok: false, code: "stale_edit" };
  }
  return { ok: true, target };
}
