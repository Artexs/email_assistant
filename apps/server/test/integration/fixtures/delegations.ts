import { randomUUID } from "node:crypto";

import { sendPayloadFor, type DraftPayload } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../../src/platform/db";

import { insertAction } from "./actions";
import { insertTriaged } from "./mail";

// One `delegates` row; the email is lower case. Returns the id.
export async function insertDelegate(
  trx: Transaction<DB>,
  ctx: TenantContext,
  opts?: { name?: string; email?: string; tags?: string[]; active?: boolean }
): Promise<string> {
  const row = await trx
    .insertInto("delegates")
    .values({
      org_id: ctx.orgId,
      name: opts?.name ?? "Delegate",
      email: opts?.email ?? `delegate-${randomUUID()}@x.test`,
      competence_tags: opts?.tags ?? [],
      active: opts?.active ?? true,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}
// One `delegations` row. The states `sent`, `answered` and `overdue` need `sent_message_id` and `sent_at`: they get defaults.
export async function insertDelegation(
  trx: Transaction<DB>,
  ctx: TenantContext,
  opts: {
    mailboxId: string;
    emailId: string;
    delegateId: string;
    draftActionId: string;
    sendActionId: string;
    status?: string;
    taskSummary?: string;
    dueAt?: Date | null;
    sentMessageId?: string | null;
    sentAt?: Date | null;
    lastReminderAt?: Date | null;
    remindersSent?: number;
    answeredAt?: Date | null;
    answeredNotifiedAt?: Date | null;
    createdAt?: Date;
  }
): Promise<string> {
  const status = opts.status ?? "drafted";
  const sentStatus = status === "sent" || status === "answered" || status === "overdue";
  const row = await trx
    .insertInto("delegations")
    .values({
      org_id: ctx.orgId,
      mailbox_id: opts.mailboxId,
      email_id: opts.emailId,
      delegate_id: opts.delegateId,
      draft_action_id: opts.draftActionId,
      send_action_id: opts.sendActionId,
      status,
      task_summary: opts.taskSummary ?? "Prepare the offer",
      due_at: opts.dueAt ?? null,
      sent_message_id:
        opts.sentMessageId === undefined ? (sentStatus ? `<sent-${randomUUID()}@x.test>` : null) : opts.sentMessageId,
      sent_at: opts.sentAt === undefined ? (sentStatus ? new Date("2026-11-05T09:00:00Z") : null) : opts.sentAt,
      last_reminder_at: opts.lastReminderAt ?? null,
      reminders_sent: opts.remindersSent ?? 0,
      answered_at: opts.answeredAt ?? null,
      answered_notified_at: opts.answeredNotifiedAt ?? null,
      ...(opts.createdAt ? { created_at: opts.createdAt } : {}),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}
// A triaged delegation mail with its `create_draft` and `send` rows, linked by `depends_on_action_id`.
// Default statuses: the draft `applied`, the send `awaiting_approval`.
export async function insertDraftAndSend(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: {
    kind?: "delegation" | "clarification" | "reminder" | "reply";
    draftStatus?: string;
    sendStatus?: string;
    to?: string;
    delegateId?: string;
    delegateName?: string;
    task?: string;
    dueDate?: string;
    language?: "pl" | "en";
    approved?: { userId: string; at: Date };
    notifiedAt?: Date | null;
    createdAt?: Date;
    lockedAt?: Date | null;
    draftProviderResult?: Record<string, unknown>;
    outgoingMessageId?: string | null;
    messageId?: string | null;
    subject?: string;
    from?: string;
    bodyText?: string;
    inReplyTo?: string | null;
    referencesHeader?: string | null;
    toAddresses?: string[];
    setId?: string;
    delegationId?: string;
    reminder?: 1 | 2;
    // Kind `reply`: the Cc of the draft, the Cc of the send when it differs, and the draft body. `to` is the To.
    cc?: string[];
    sendCc?: string[];
    replyBody?: string;
    // Also insert the `sent` outbox row of the approval request, for the first member of the organization.
    requestSent?: boolean;
  }
): Promise<{ emailId: string; draftId: string; sendId: string }> {
  const createdAt = opts.createdAt ?? new Date();
  const kind = opts.kind ?? (opts.reminder === undefined ? "delegation" : "reminder");
  const to = opts.to ?? `delegate-${randomUUID()}@x.test`;
  const language = opts.language ?? "en";
  const task = opts.task ?? "Prepare the offer";
  const delegate = {
    delegate_id: opts.delegateId ?? randomUUID(),
    delegate_name: opts.delegateName ?? "Delegate",
    to: [to],
    task,
    due_date: opts.dueDate ?? "",
    language,
  };
  const draft: DraftPayload =
    kind === "clarification"
      ? { kind, to: [to], question: task, language }
      : kind === "reply"
        ? {
            kind,
            to: [to],
            cc: opts.cc ?? [],
            language,
            body: opts.replyBody ?? "Thank you, I will check and reply.",
            request_id: randomUUID(),
            folder: "INBOX",
            recipients: "from",
          }
        : kind === "reminder"
          ? {
              kind,
              ...delegate,
              delegation_id: opts.delegationId ?? randomUUID(),
              reminder: opts.reminder ?? 1,
              thread: { in_reply_to: null, references: [] },
            }
          : { kind, ...delegate };
  const draftPayload: Record<string, unknown> = { ...draft };
  if (opts.delegationId !== undefined) draftPayload.delegation_id = opts.delegationId;
  const sendPayload: Record<string, unknown> = { ...sendPayloadFor(draft) };
  if (opts.sendCc !== undefined) sendPayload.cc = opts.sendCc;
  if (opts.delegationId !== undefined) sendPayload.delegation_id = opts.delegationId;
  if (opts.setId !== undefined) sendPayload.set_id = opts.setId;

  const emailId = await insertTriaged(trx, ctx, mailboxId, {
    category: kind === "clarification" || kind === "reply" ? "needs_reply" : "delegation",
    createdAt,
    subject: opts.subject,
    from: opts.from,
    messageId: opts.messageId,
  });
  await trx
    .updateTable("emails")
    .set({
      body_text: opts.bodyText ?? null,
      in_reply_to: opts.inReplyTo ?? null,
      references_header: opts.referencesHeader ?? null,
      to_addresses: opts.toAddresses ?? [],
    })
    .where("id", "=", emailId)
    .where("org_id", "=", ctx.orgId)
    .execute();

  const day = createdAt.toISOString().slice(0, 10);
  const suffix = kind === "reminder" ? `:reminder:${day}` : "";
  const draftId = await insertAction(trx, ctx, emailId, {
    type: "create_draft",
    status: opts.draftStatus ?? "applied",
    payload: draftPayload,
    idempotencyKey: `${emailId}:create_draft${suffix}`,
    providerResult: opts.draftProviderResult ?? null,
    createdAt,
  });
  const sendId = await insertAction(trx, ctx, emailId, {
    type: "send",
    status: opts.sendStatus ?? "awaiting_approval",
    payload: sendPayload,
    idempotencyKey: `${emailId}:send${suffix}`,
    dependsOnActionId: draftId,
    notifiedAt: opts.notifiedAt ?? null,
    approvedBy: opts.approved?.userId ?? null,
    approvedAt: opts.approved?.at ?? null,
    approvedVia: opts.approved === undefined ? null : "telegram",
    outgoingMessageId: opts.outgoingMessageId ?? null,
    lockedAt: opts.lockedAt ?? null,
    createdAt,
  });
  if (opts.requestSent === true) {
    const member = await trx
      .selectFrom("memberships")
      .select("user_id")
      .where("org_id", "=", ctx.orgId)
      .orderBy("user_id")
      .executeTakeFirstOrThrow();
    const at = opts.notifiedAt ?? createdAt;
    await trx
      .insertInto("outbox")
      .values({
        org_id: ctx.orgId,
        user_id: member.user_id,
        kind: opts.setId === undefined ? "approval" : "approval_set",
        dedup_key: opts.setId === undefined ? `approval:${sendId}` : `approval_set:${opts.setId}`,
        email_id: emailId,
        text: "Approve?",
        buttons: "[]",
        status: "sent",
        created_at: at,
        next_attempt_at: at,
        sent_at: at,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
  return { emailId, draftId, sendId };
}
