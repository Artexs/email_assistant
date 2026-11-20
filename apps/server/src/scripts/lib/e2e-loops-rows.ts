import { DAY_MS, HOUR_MS } from "@ea/core";

import { auditEvents, recordAudit } from "../../modules/audit";
import type { Db, TenantContext } from "../../platform/db";
import { E2E_LOOPS_OLD_CONSENT, E2E_LOOPS_SUBJECTS } from "../e2e-seed-args";

import { insertMails, inTransaction } from "./e2e-activity-rows";

const FIRST_UID = 930_001;

export interface LoopsSeedIds {
  replyEmailId: string;
}

// The rows of the loops spec for one organization: three triaged mails (a needs-reply and an unsure one, which
// show the Delegate action, and a newsletter, which does not), "Track my sent mail" on for the mailbox, and the owner linked to
// Telegram with a consent of an old version. The mail rows are test mail; nothing here is read by a job of the e2e server.
export async function seedLoopsRows(
  db: Db,
  ctx: TenantContext,
  mailboxId: string,
  ownerId: string,
  chatId: number,
  now: Date
): Promise<LoopsSeedIds> {
  const ago = (ms: number): Date => new Date(now.getTime() - ms);
  return inTransaction(db, async (trx) => {
    const [replyEmailId] = await insertMails(trx, ctx, mailboxId, [
      {
        uid: FIRST_UID,
        receivedAt: ago(2 * HOUR_MS),
        subject: E2E_LOOPS_SUBJECTS.reply,
        from: "anna@e2e.test",
        category: "needs_reply",
        confidence: 0.9,
        reasonCode: "direct_request",
        reason: "Anna asks for an answer.",
        bodyText: "E2E loops: please answer my question.",
      },
      {
        uid: FIRST_UID + 1,
        receivedAt: ago(3 * HOUR_MS),
        subject: E2E_LOOPS_SUBJECTS.unsure,
        from: "boss@e2e.test",
        category: "unsure",
        confidence: 0.4,
        reasonCode: "unclear",
        reason: "The model is not sure what this mail wants.",
        bodyText: "E2E loops: an unclear note.",
      },
      {
        uid: FIRST_UID + 2,
        receivedAt: ago(4 * HOUR_MS),
        subject: E2E_LOOPS_SUBJECTS.newsletter,
        from: "news@e2e.test",
        category: "info",
        confidence: 0.9,
        reasonCode: "informational",
        reason: "A newsletter.",
        bodyText: "E2E loops: weekly news.",
      },
    ]);
    if (replyEmailId === undefined) throw new Error("no mail was inserted");
    await trx
      .insertInto("mailbox_sent_sync")
      .values({ org_id: ctx.orgId, mailbox_id: mailboxId, enabled: true, enabled_at: now, first_pass_at: now })
      .execute();
    // A chat that the CLI linked has no consent row; this one has a row of an old version (the spec confirms the new terms).
    await trx
      .insertInto("chat_links")
      .values({
        org_id: ctx.orgId,
        user_id: ownerId,
        channel: "telegram",
        external_chat_id: chatId,
        linked_at: ago(DAY_MS),
      })
      .execute();
    await recordAudit(trx, ctx, {
      event: auditEvents.webTelegramConsent,
      actor: ownerId,
      data: { via: "web", version: E2E_LOOPS_OLD_CONSENT },
      at: ago(DAY_MS),
    });
    return { replyEmailId };
  });
}
