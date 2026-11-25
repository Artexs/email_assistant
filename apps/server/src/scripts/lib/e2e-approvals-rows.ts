import { randomUUID } from "node:crypto";

import { DAY_MS, type DraftPayload, MINUTE_MS, sendPayloadFor } from "@ea/core";
import type { Transaction } from "kysely";

import type { Db, DB, TenantContext } from "../../platform/db";
import { E2E_APPROVALS, E2E_QUEUE } from "../e2e-seed-args";

import { insertAction, insertMails, inTransaction } from "./e2e-activity-rows";

export interface ApprovalsSeedResult {
  waitingSendId: string;
  heldSendId: string;
  editSendId: string;
  closedSendId: string;
  raceSendId: string;
  reminderSendId: string;
}

const FIRST_UID = 910_001;

interface Plan {
  delegateName: string;
  delegateEmail: string;
  subject: string;
  from: string;
  body: string;
  task: string;
}

// One delegation mail with its delegate, `create_draft` (applied), `send` and the `drafted` delegation. The mail is test mail
// (its Message-ID ends in `@ea-seed.test`, as `insertMails` makes it), so the committer of the e2e server (ACTIONS_SCOPE=synthetic) takes it.
async function seedSend(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  plan: Plan,
  index: number,
  now: Date,
  approved: { userId: string } | null,
  // Sends of one delegate share its row (the address is unique in an organization).
  delegates: Map<string, string>,
  kind: "delegation" | "reminder" = "delegation"
): Promise<string> {
  const at = new Date(now.getTime() - (index + 1) * MINUTE_MS);
  const [emailId] = await insertMails(trx, ctx, mailboxId, [
    {
      uid: FIRST_UID + index,
      receivedAt: new Date(at.getTime() - 10 * MINUTE_MS),
      subject: plan.subject,
      from: plan.from,
      category: "delegation",
      confidence: 0.9,
      reasonCode: "direct_request",
      reason: "A task for a delegate.",
      bodyText: plan.body,
    },
  ]);
  if (emailId === undefined) throw new Error("no mail was inserted");
  let delegateId = delegates.get(plan.delegateEmail);
  if (delegateId === undefined) {
    const delegate = await trx
      .insertInto("delegates")
      .values({
        org_id: ctx.orgId,
        name: plan.delegateName,
        email: plan.delegateEmail,
        competence_tags: [],
        active: true,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    delegateId = delegate.id;
    delegates.set(plan.delegateEmail, delegateId);
  }
  const common = {
    delegate_id: delegateId,
    delegate_name: plan.delegateName,
    to: [plan.delegateEmail],
    task: plan.task,
    due_date: "",
    language: "en" as const,
  };
  // The reminder points at a delegation that the seed does not create: the page reads only the payload.
  const draft: DraftPayload =
    kind === "reminder"
      ? {
          kind,
          ...common,
          delegation_id: randomUUID(),
          reminder: 1,
          thread: { in_reply_to: null, references: [] },
        }
      : { kind, ...common };
  const draftId = await insertAction(trx, ctx, {
    emailId,
    type: "create_draft",
    status: "applied",
    payload: { ...draft },
    createdAt: at,
  });
  const sendId = await insertAction(trx, ctx, {
    emailId,
    type: "send",
    status: approved === null ? "awaiting_approval" : "approved",
    payload: { ...sendPayloadFor(draft) },
    createdAt: new Date(at.getTime() + 1000),
    dependsOnActionId: draftId,
    // The approval notice job leaves a notified action alone; no chat is linked, so no card is queued.
    notifiedAt: now,
    ...(approved === null ? {} : { approved: { userId: approved.userId, at: now, via: "web" as const } }),
  });
  if (kind === "reminder") return sendId;
  await trx
    .insertInto("delegations")
    .values({
      org_id: ctx.orgId,
      mailbox_id: mailboxId,
      email_id: emailId,
      delegate_id: delegateId,
      draft_action_id: draftId,
      send_action_id: sendId,
      status: "drafted",
      task_summary: plan.task,
      due_at: new Date(now.getTime() + 2 * DAY_MS),
    })
    .execute();
  return sendId;
}

// The waiting send (to the delegate that SEND_SCOPE=self admits), the send that the owner approved and the scope holds, a second
// waiting send for the edit that is approved, and a waiting reminder.
export async function seedApprovalsRows(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  ownerId: string,
  now: Date
): Promise<ApprovalsSeedResult> {
  return inTransaction(db, async (trx) => {
    const delegates = new Map<string, string>();
    return {
      waitingSendId: await seedSend(trx, ctx, mailboxId, E2E_APPROVALS.waiting, 0, now, null, delegates),
      heldSendId: await seedSend(trx, ctx, mailboxId, E2E_APPROVALS.held, 1, now, { userId: ownerId }, delegates),
      editSendId: await seedSend(trx, ctx, mailboxId, E2E_APPROVALS.edit, 2, now, null, delegates),
      closedSendId: await seedSend(trx, ctx, mailboxId, E2E_APPROVALS.closed, 3, now, null, delegates),
      raceSendId: await seedSend(trx, ctx, mailboxId, E2E_APPROVALS.race, 4, now, null, delegates),
      reminderSendId: await seedSend(trx, ctx, mailboxId, E2E_APPROVALS.reminder, 5, now, null, delegates, "reminder"),
    };
  });
}

export interface QueueSeedResult {
  // The waiting sends in list order: the newest first.
  waitingSendIds: string[];
  heldSendId: string;
}

// Five waiting sends to the delegate that SEND_SCOPE=self admits and one approved send that the scope holds. The first draft of the plan
// is the oldest one, so the list shows the last draft of the plan first.
export async function seedQueueRows(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  ownerId: string,
  now: Date
): Promise<QueueSeedResult> {
  return inTransaction(db, async (trx) => {
    const delegates = new Map<string, string>();
    const sendIds: string[] = [];
    for (const [index, plan] of E2E_QUEUE.drafts.entries()) {
      sendIds.push(await seedSend(trx, ctx, mailboxId, plan, E2E_QUEUE.drafts.length - index, now, null, delegates));
    }
    const heldSendId = await seedSend(trx, ctx, mailboxId, E2E_QUEUE.held, 0, now, { userId: ownerId }, delegates);
    return { waitingSendIds: sendIds.reverse(), heldSendId };
  });
}
