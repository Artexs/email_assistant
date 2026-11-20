import { randomUUID } from "node:crypto";

import { type DraftPayload, MINUTE_MS, sendPayloadFor } from "@ea/core";
import type { Transaction } from "kysely";

import type { Db, DB, TenantContext } from "../../platform/db";
import { E2E_REPLY_PANEL } from "../e2e-seed-args";

import { insertAction, insertMails, inTransaction } from "./e2e-activity-rows";

export interface ReplyPanelSeedResult {
  sendIds: Record<"gap" | "plain" | "plainTwo" | "all" | "viaReplyTo", string>;
  mailIds: Record<"gap" | "clean" | "flagged", string>;
}

const FIRST_UID = 920_001;

interface MailPlan {
  from: string;
  subject: string;
  to?: readonly string[];
  cc?: readonly string[];
  replyTo?: readonly string[];
  suspicious?: boolean;
}

// One triaged `needs_reply` mail of a person (the rows that the reply rules read: the result, the headers, the addresses) and the
// text of the mail. The mail is test mail (its Message-ID ends in `@ea-seed.test`), so the committer of the e2e server takes its draft.
async function seedMail(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  mailboxAddress: string,
  plan: MailPlan,
  index: number,
  now: Date
): Promise<string> {
  const receivedAt = new Date(now.getTime() - (index + 2) * 10 * MINUTE_MS);
  const [emailId] = await insertMails(trx, ctx, mailboxId, [
    {
      uid: FIRST_UID + index,
      receivedAt,
      subject: plan.subject,
      from: plan.from,
      category: "needs_reply",
      confidence: 0.9,
      reasonCode: "direct_request",
      reason: "A question that needs an answer.",
      bodyText: "Czy wtorek o dziesiątej Ci pasuje?",
      fields: { language: "pl" },
    },
  ]);
  if (emailId === undefined) throw new Error("no mail was inserted");
  await trx
    .updateTable("emails")
    .set({ to_addresses: [mailboxAddress, ...(plan.to ?? [])], cc_addresses: [...(plan.cc ?? [])] })
    .where("id", "=", emailId)
    .execute();
  if (plan.suspicious === true) {
    await trx
      .updateTable("triage_results")
      .set({ suspicious_reasons: ["lookalike_domain"] })
      .where("email_id", "=", emailId)
      .execute();
  }
  await trx
    .insertInto("email_headers")
    .values({
      email_id: emailId,
      org_id: ctx.orgId,
      reply_to: [...(plan.replyTo ?? [])],
      parts_known: true,
      captured_at: receivedAt,
    })
    .execute();
  return emailId;
}

// A reply draft that the committer applied and its send that waits for a tap: the pair of the drafter job.
async function seedReplySend(
  trx: Transaction<DB>,
  ctx: TenantContext,
  emailId: string,
  plan: MailPlan,
  body: string,
  version: number,
  now: Date
): Promise<string> {
  const draft: DraftPayload = {
    kind: "reply",
    to: [plan.from],
    cc: [],
    language: "pl",
    body,
    request_id: randomUUID(),
    folder: "INBOX",
    recipients: "from",
    ...(version > 1 ? { version } : {}),
  };
  const at = new Date(now.getTime() - 5 * MINUTE_MS);
  const draftId = await insertAction(trx, ctx, {
    emailId,
    type: "create_draft",
    status: "applied",
    payload: { ...draft },
    createdAt: at,
  });
  return insertAction(trx, ctx, {
    emailId,
    type: "send",
    status: "awaiting_approval",
    payload: { ...sendPayloadFor(draft) },
    createdAt: new Date(at.getTime() + 1000),
    dependsOnActionId: draftId,
    // No chat is linked, so no card is queued; a notified send keeps the notice job away.
    notifiedAt: now,
  });
}

// The rows of the reply panel spec: five waiting reply drafts and two mails with no draft (see `E2E_REPLY_PANEL`). The reply request of
// `plainTwo` is the redraft that made it (the line "tak na wtorek"), so its page shows four redrafts left.
export async function seedReplyPanelRows(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  mailboxAddress: string,
  ownerId: string,
  now: Date
): Promise<ReplyPanelSeedResult> {
  return inTransaction(db, async (trx) => {
    const p = E2E_REPLY_PANEL;
    const mail = (plan: MailPlan, index: number) => seedMail(trx, ctx, mailboxId, mailboxAddress, plan, index, now);
    const gapMail = await mail(p.gap, 0);
    const plainMail = await mail(p.plain, 1);
    const plainTwoMail = await mail(p.plainTwo, 2);
    const allMail = await mail(p.all, 3);
    const viaReplyToMail = await mail(p.viaReplyTo, 4);
    const cleanMail = await mail(p.clean, 5);
    const flaggedMail = await mail({ ...p.flagged, suspicious: true }, 6);

    const sendIds = {
      gap: await seedReplySend(trx, ctx, gapMail, p.gap, p.gap.body, 1, now),
      plain: await seedReplySend(trx, ctx, plainMail, p.plain, p.plain.body, 1, now),
      plainTwo: await seedReplySend(trx, ctx, plainTwoMail, p.plainTwo, p.plainTwo.body, 2, now),
      all: await seedReplySend(trx, ctx, allMail, p.all, p.all.body, 1, now),
      viaReplyTo: await seedReplySend(trx, ctx, viaReplyToMail, p.viaReplyTo, p.viaReplyTo.body, 1, now),
    };
    const thread = await trx
      .selectFrom("emails")
      .select("thread_key")
      .where("id", "=", plainTwoMail)
      .executeTakeFirstOrThrow();
    await trx
      .insertInto("reply_requests")
      .values({
        org_id: ctx.orgId,
        mailbox_id: mailboxId,
        email_id: plainTwoMail,
        thread_key: thread.thread_key,
        folder: "INBOX",
        trigger: "redraft",
        status: "done",
        instruction: p.plainTwo.instruction,
        requested_by: ownerId,
        send_action_id: sendIds.plainTwo,
      })
      .execute();
    return { sendIds, mailIds: { gap: gapMail, clean: cleanMail, flagged: flaggedMail } };
  });
}
