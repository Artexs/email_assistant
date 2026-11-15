import { textTables, userLocaleSchema } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { getOrganization } from "../tenancy";

import { queueNotice } from "./notice-queue";
import { OUTBOX_REMOVED_TEXT } from "./repo";

// "Track my sent mail" went off: the cards of the follow-ups of the mailbox (`outbox.loop_id` names a loop of it) hold the
// Sent mail in their `view` (recipients, subject, quote) and `text` (what the chat shows). Both go, as retention clears
// a card: text `[removed]`, view `{}`. A card that no sender has delivered (`pending`, or `sending` with its claim) ends
// `failed` / `outdated` instead, so the sender never renders it later and cannot write the text back. A message that
// Telegram already delivered stays in the chat: nothing here can recall it, but its text and its buttons can change: a
// delivered card whose follow-up the switch expired gets one edit (`approval_edit`, outcome `expired`) with a fixed text of
// ours as the original: no quote, no address, no subject. The edit rows are queued after the blanking below, so they are not
// blanked themselves. A card already blank is not touched. The caller holds the transaction of the switch. Returns the row count.
export async function clearLoopCards(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: { mailboxId: string; at: Date }
): Promise<number> {
  const delivered = await listDeliveredCardsOfExpiredFollowUps(trx, ctx, input.mailboxId);
  const ofMailbox = (eb: { selectFrom: Transaction<DB>["selectFrom"] }) =>
    eb.selectFrom("open_loops").select("id").where("org_id", "=", ctx.orgId).where("mailbox_id", "=", input.mailboxId);
  const waiting = await trx
    .updateTable("outbox")
    .set({
      status: "failed",
      error_code: "outdated",
      locked_at: null,
      text: OUTBOX_REMOVED_TEXT,
      view: JSON.stringify({}),
    })
    .where("org_id", "=", ctx.orgId)
    .where("loop_id", "in", ofMailbox(trx))
    .where("status", "in", ["pending", "sending"])
    .executeTakeFirstOrThrow();
  const blanked = await trx
    .updateTable("outbox")
    .set({ text: OUTBOX_REMOVED_TEXT, view: JSON.stringify({}) })
    .where("org_id", "=", ctx.orgId)
    .where("loop_id", "in", ofMailbox(trx))
    .where("status", "in", ["sent", "failed"])
    .where((eb) => eb.or([eb("text", "is distinct from", OUTBOX_REMOVED_TEXT), eb("view", "!=", JSON.stringify({}))]))
    .executeTakeFirstOrThrow();
  await queueRemovalEdits(trx, ctx, delivered, input.at);
  return Number(waiting.numUpdatedRows) + Number(blanked.numUpdatedRows);
}

interface DeliveredCard {
  id: string;
  userId: string;
  loopId: string;
  locale: string;
}

// The cards that Telegram delivered (a message id is known) for a follow-up that ended `expired` / `loop_closed` and still
// show their buttons: no `expired` edit exists for them yet. A card with no text of ours left has nothing to edit from, but
// the fixed text does not need it: it is listed too.
async function listDeliveredCardsOfExpiredFollowUps(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string
): Promise<DeliveredCard[]> {
  const rows = await trx
    .selectFrom("outbox as card")
    .innerJoin("actions", (join) =>
      join
        .onRef("actions.org_id", "=", "card.org_id")
        .on(sql<boolean>`card.dedup_key = 'approval:' || actions.id::text`)
    )
    .innerJoin("open_loops", (join) =>
      join.onRef("open_loops.id", "=", "actions.loop_id").onRef("open_loops.org_id", "=", "actions.org_id")
    )
    .select(["card.id", "card.user_id", "card.locale", "actions.loop_id"])
    .where("card.org_id", "=", ctx.orgId)
    .where("card.kind", "=", "approval")
    .where("card.status", "=", "sent")
    .where("card.external_message_id", "is not", null)
    .where("actions.type", "=", "send")
    .where("actions.status", "=", "expired")
    .where("actions.status_reason", "=", "loop_closed")
    .where("open_loops.mailbox_id", "=", mailboxId)
    .where(
      sql<boolean>`not exists (
        select 1 from outbox edit
        where edit.org_id = card.org_id and edit.user_id = card.user_id
          and edit.dedup_key = 'approval_edit:' || card.id::text || ':expired')`
    )
    .orderBy("card.id")
    .execute();
  return rows.flatMap((row) =>
    row.loop_id === null ? [] : [{ id: row.id, userId: row.user_id, loopId: row.loop_id, locale: row.locale }]
  );
}

async function queueRemovalEdits(
  trx: Transaction<DB>,
  ctx: TenantContext,
  cards: readonly DeliveredCard[],
  at: Date
): Promise<void> {
  if (cards.length === 0) return;
  const organization = await getOrganization(trx, ctx);
  if (organization === undefined) return;
  for (const card of cards) {
    const locale = userLocaleSchema.parse(card.locale);
    await queueNotice(trx, ctx, {
      userId: card.userId,
      locale,
      kind: "approval_edit",
      dedupKey: `approval_edit:${card.id}:expired`,
      loopId: card.loopId,
      editOfOutboxId: card.id,
      view: {
        original: textTables[locale].approvals.followUpRemoved,
        outcome: "expired",
        at,
        timeZone: organization.timezone,
      },
      now: at,
    });
  }
}
