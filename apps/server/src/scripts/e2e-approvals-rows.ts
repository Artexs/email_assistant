import { sendPayloadFor, type DraftPayload } from "@ea/core";
import type { Transaction } from "kysely";

import type { Db, DB, TenantContext } from "../platform/db";

import { insertAction, insertMails, inTransaction } from "./e2e-activity-rows";
import { E2E_APPROVALS } from "./e2e-seed-args";

export interface ApprovalsSeedResult {
  waitingSendId: string;
  heldSendId: string;
}

const MINUTE = 60_000;
const FIRST_UID = 910_001;

type Plan = (typeof E2E_APPROVALS)[keyof typeof E2E_APPROVALS];

// One delegation mail with its delegate, `create_draft` (applied), `send` and the `drafted` delegation. The mail is test mail
// (its Message-ID ends in `@ea-seed.test`, as `insertMails` makes it), so the committer of the e2e server (ACTIONS_SCOPE=synthetic) takes it.
async function seedSend(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  plan: Plan,
  index: number,
  now: Date,
  approved: { userId: string } | null
): Promise<string> {
  const at = new Date(now.getTime() - (index + 1) * MINUTE);
  const [emailId] = await insertMails(trx, ctx, mailboxId, [
    {
      uid: FIRST_UID + index,
      receivedAt: new Date(at.getTime() - 10 * MINUTE),
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
  const draft: DraftPayload = {
    kind: "delegation",
    delegate_id: delegate.id,
    delegate_name: plan.delegateName,
    to: [plan.delegateEmail],
    task: plan.task,
    due_date: "",
    language: "en",
  };
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
  await trx
    .insertInto("delegations")
    .values({
      org_id: ctx.orgId,
      mailbox_id: mailboxId,
      email_id: emailId,
      delegate_id: delegate.id,
      draft_action_id: draftId,
      send_action_id: sendId,
      status: "drafted",
      task_summary: plan.task,
      due_at: new Date(now.getTime() + 2 * 24 * 60 * MINUTE),
    })
    .execute();
  return sendId;
}

// The waiting send (to the delegate that SEND_SCOPE=self admits) and the send that the owner approved and the scope holds.
export async function seedApprovalsRows(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  ownerId: string,
  now: Date
): Promise<ApprovalsSeedResult> {
  return inTransaction(db, async (trx) => ({
    waitingSendId: await seedSend(trx, ctx, mailboxId, E2E_APPROVALS.waiting, 0, now, null),
    heldSendId: await seedSend(trx, ctx, mailboxId, E2E_APPROVALS.held, 1, now, { userId: ownerId }),
  }));
}
