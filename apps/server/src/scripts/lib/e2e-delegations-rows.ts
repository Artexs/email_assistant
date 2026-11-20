import { randomUUID } from "node:crypto";

import { DAY_MS, type DraftPayload, MINUTE_MS, sendPayloadFor } from "@ea/core";
import { sql, type Transaction } from "kysely";

import type { Db, DB, TenantContext } from "../../platform/db";
import { E2E_DELEGATIONS, type DelegationsSeedIds } from "../e2e-seed-args";

import { insertAction, insertMails, inTransaction } from "./e2e-activity-rows";

const FIRST_UID = 920_001;

type Plan = (typeof E2E_DELEGATIONS)[keyof typeof E2E_DELEGATIONS];

// One delegation with its mail, delegate, applied `create_draft` and `send`. A `drafted` delegation has a send that waits for an
// approval; every other state has a send that went out (`applied`). The mail is test mail (its Message-ID ends in `@ea-seed.test`).
export async function seedDelegation(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  plan: Plan,
  index: number,
  now: Date,
  ownerId: string
): Promise<{ delegationId: string; sendId: string }> {
  const at = new Date(now.getTime() - (index + 1) * MINUTE_MS);
  const [emailId] = await insertMails(trx, ctx, mailboxId, [
    {
      uid: FIRST_UID + index,
      receivedAt: new Date(at.getTime() - 10 * MINUTE_MS),
      subject: plan.subject,
      from: "boss@example.net",
      category: "delegation",
      confidence: 0.9,
      reasonCode: "direct_request",
      reason: "A task for a delegate.",
      bodyText: `E2E original request: ${plan.task}`,
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
      active: plan.delegateActive,
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
  const drafted = plan.status === "drafted";
  const sendId = await insertAction(trx, ctx, {
    emailId,
    type: "send",
    status: drafted ? "awaiting_approval" : "applied",
    payload: { ...sendPayloadFor(draft) },
    createdAt: new Date(at.getTime() + 1000),
    dependsOnActionId: draftId,
    // The approval notice job leaves a notified action alone; no chat is linked, so no card is queued.
    notifiedAt: now,
    // A send that went out has an approval (a database check).
    ...(drafted ? {} : { approved: { userId: ownerId, at: at, via: "web" as const } }),
  });
  const sentStatus = plan.status === "sent" || plan.status === "answered" || plan.status === "overdue";
  const delegation = await trx
    .insertInto("delegations")
    .values({
      org_id: ctx.orgId,
      mailbox_id: mailboxId,
      email_id: emailId,
      delegate_id: delegate.id,
      draft_action_id: draftId,
      send_action_id: sendId,
      status: plan.status,
      task_summary: plan.task,
      due_at: new Date(now.getTime() + plan.dueInDays * DAY_MS),
      sent_message_id: sentStatus ? `<sent-${randomUUID()}@e2e.test>` : null,
      sent_at: drafted ? null : new Date(now.getTime() - 3 * DAY_MS),
      reminders_sent: plan.remindersSent,
      // The chaser of the e2e server (one run each minute) plans a reminder for an overdue delegation that has no reminder in the last
      // 3 days: a planned reminder would change the rows under the spec. "Remind now" has no gap rule, so the spec is not affected.
      last_reminder_at: sentStatus ? now : null,
      answered_at: plan.status === "answered" ? new Date(now.getTime() - DAY_MS) : null,
      // The newest first: the list orders by `created_at`, so the seed order is the order on the page.
      created_at: new Date(now.getTime() - index * MINUTE_MS),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  // As `saveTriage` does: the two payloads name the delegation (a cancel or a reject of the send finds the delegation through it).
  await trx
    .updateTable("actions")
    .set({ payload: sql`payload || ${JSON.stringify({ delegation_id: delegation.id })}::jsonb` })
    .where("id", "in", [draftId, sendId])
    .execute();
  return { delegationId: delegation.id, sendId };
}

// One delegation for each state and each reason that Remind now is off, see `E2E_DELEGATIONS`.
export async function seedDelegationsRows(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  ownerId: string,
  now: Date
): Promise<DelegationsSeedIds> {
  return inTransaction(db, async (trx) => {
    const ids = {} as Record<keyof typeof E2E_DELEGATIONS, { delegationId: string; sendId: string }>;
    let index = 0;
    for (const key of Object.keys(E2E_DELEGATIONS) as (keyof typeof E2E_DELEGATIONS)[]) {
      ids[key] = await seedDelegation(trx, ctx, mailboxId, E2E_DELEGATIONS[key], index, now, ownerId);
      index += 1;
    }
    return { draftedSendId: ids.drafted.sendId };
  });
}
