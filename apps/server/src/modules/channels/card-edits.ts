import type { HeldBy } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import type { ApprovalHooks, SendScope } from "../actions";
import { getOrganization } from "../tenancy";

import { failPendingCardsOfSend, listCardsOfSend, newestEditCreatedAt } from "./card-edits-repo";
import { heldReason } from "./held-reason";
import { queueNotice } from "./notice-queue";
import { OUTBOX_REMOVED_TEXT } from "./repo";

const log = createLog("channels");

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

// After a decision on a send, every owner's sent card of that send shows the result and loses its
// buttons. Runs in the transaction of the decision. One `approval_edit` row per card and outcome; the sender edits
// the Telegram message. `sendId` is the send that the card asks about. `exceptUserId` is the user whose own tap edits the
// card in place. A card of a reminder set (`approval_set:`) gets no edit.
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
    const { text, externalMessageId, emailId, loopId } = card;
    // A card whose text retention removed has nothing to show: the edit would copy the marker.
    if (
      card.status !== "sent" ||
      !text ||
      text === OUTBOX_REMOVED_TEXT ||
      externalMessageId === null ||
      (emailId === null && loopId === null)
    ) {
      continue;
    }
    // A decision reads its clock before it waits for the send lock, so a decision that commits later can carry an earlier time.
    // The sender drops a row when a newer row of the card went out (`newerEditSent`): the row of the later decision must
    // sort after the earlier one, or the card would keep the older result. One millisecond after the newest row.
    const newest = await newestEditCreatedAt(trx, ctx, card.id);
    const queuedAt =
      newest !== null && newest.getTime() >= input.at.getTime() ? new Date(newest.getTime() + 1) : input.at;
    const id = await queueNotice(trx, ctx, {
      userId: card.userId,
      locale: card.locale,
      kind: "approval_edit",
      dedupKey: `approval_edit:${card.id}:${input.outcome}`,
      ...(emailId === null ? {} : { emailId }),
      ...(loopId === null ? {} : { loopId }),
      editOfOutboxId: card.id,
      view: {
        original: text,
        outcome: input.outcome,
        at: input.at,
        timeZone: organization.timezone,
        ...(input.heldBy === undefined ? {} : { heldBy: input.heldBy }),
        // The Reject button of the held card names the send.
        ...(input.outcome === "approved_held" ? { actionId: input.sendId } : {}),
        // The `minimal` edit links to the send in the panel when the card has no link.
        sendId: input.sendId,
      },
      now: input.at,
      createdAt: queuedAt,
    });
    if (id !== null) queued += 1;
  }
  return { queued, cancelled: await failPendingCardsOfSend(trx, ctx, input.sendId) };
}

const SAVEPOINT = "card_edits";

// The real `ApprovalHooks`. Runs in the transaction of the decision, with no call to the outside.
// `approved` becomes `approved_held` when `heldReason` names a cause. Card sync is best effort: a failure here (a view that
// does not render, a database error) is logged and undone to a savepoint, and the decision stays. The send of the edit is
// the sender's; its failures end the edit row as `failed` (the visible state).
export function cardEditHooks(deps: { sendScope: SendScope }): ApprovalHooks {
  return {
    async onDecided(trx, ctx, input) {
      await sql`savepoint ${sql.id(SAVEPOINT)}`.execute(trx);
      try {
        const { decision } = input;
        const heldBy =
          decision === "approved"
            ? await heldReason({ db: trx, sendScope: deps.sendScope }, ctx, input.sendId)
            : undefined;
        const edit: CardEdit = heldBy === undefined ? { outcome: decision } : { outcome: "approved_held", heldBy };
        await queueCardEdits(trx, ctx, {
          ...edit,
          sendId: input.sendId,
          ...(input.exceptUserId === undefined ? {} : { exceptUserId: input.exceptUserId }),
          at: input.at,
        });
      } catch (error) {
        await sql`rollback to savepoint ${sql.id(SAVEPOINT)}`.execute(trx);
        log.error("card_edits_not_queued", { kind: input.decision, action_id: input.sendId, ...errorFields(error) });
      }
      await sql`release savepoint ${sql.id(SAVEPOINT)}`.execute(trx);
    },
  };
}
