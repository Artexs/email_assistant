import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";

import { OUTBOX_REMOVED_TEXT } from "./repo";

// "Track my sent mail" went off: the cards of the follow-ups of the mailbox (`outbox.loop_id` names a loop of it) hold the
// Sent mail in their `view` (recipients, subject, quote) and `text` (what the chat shows). Both go, as retention clears
// a card: text `[removed]`, view `{}`. A card that no sender has delivered (`pending`, or `sending` with its claim) ends
// `failed` / `outdated` instead, so the sender never renders it later and cannot write the text back. A message that
// Telegram already delivered stays in the chat: nothing here can recall it. A card already blank is not touched. The
// caller holds the transaction of the switch. Returns the row count.
export async function clearLoopCards(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: { mailboxId: string }
): Promise<number> {
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
  const delivered = await trx
    .updateTable("outbox")
    .set({ text: OUTBOX_REMOVED_TEXT, view: JSON.stringify({}) })
    .where("org_id", "=", ctx.orgId)
    .where("loop_id", "in", ofMailbox(trx))
    .where("status", "in", ["sent", "failed"])
    .where((eb) => eb.or([eb("text", "is distinct from", OUTBOX_REMOVED_TEXT), eb("view", "!=", JSON.stringify({}))]))
    .executeTakeFirstOrThrow();
  return Number(waiting.numUpdatedRows) + Number(delivered.numUpdatedRows);
}
