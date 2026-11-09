import { randomUUID } from "node:crypto";

import { sendPayloadFor, type ActionType, type Category, type DraftPayload, type MembershipRole } from "@ea/core";
import type { Transaction } from "kysely";

import { noDelegationHooks, type ApplyDeps } from "../../src/modules/actions";
import { composeMessage, type MailCapabilities, type NewEmail } from "../../src/modules/mail";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import type { DB, TenantContext } from "../../src/platform/db";

export const testCapabilities: MailCapabilities = {
  idle: true,
  move: true,
  uidplus: true,
  condstore: true,
  specialUse: true,
  keywords: true,
};

// The S4 fields of `ApplyDeps` for tests that apply no draft or send.
export function applyDepsDefaults(): Pick<
  ApplyDeps,
  "mailbox" | "owner" | "organization" | "compose" | "sender" | "hooks"
> {
  return {
    mailbox: { address: "box@x.test", capabilities: { uidplus: true }, folderMap: {} },
    owner: { displayName: "Owner" },
    organization: { styleText: null, timezone: "Europe/Warsaw" },
    compose: composeMessage,
    sender: null,
    hooks: noDelegationHooks,
  };
}

export async function createOrgWithMailbox(
  trx: Transaction<DB>,
  opts?: { address?: string }
): Promise<{ orgId: string; userId: string; mailboxId: string }> {
  const suffix = randomUUID();
  const { orgId, userId } = await createOrganizationWithOwner(trx, {
    orgName: `Org ${suffix}`,
    timezone: "Europe/Warsaw",
    email: `owner-${suffix}@x.test`,
    displayName: "Owner",
  });
  const mailboxId = randomUUID();
  await insertMailbox(
    trx,
    { orgId },
    {
      id: mailboxId,
      address: opts?.address ?? `box-${suffix}@x.test`,
      imapHost: "imap.x.test",
      imapPort: 993,
      smtpHost: "smtp.x.test",
      smtpPort: 465,
      capabilities: testCapabilities,
      folderMap: { drafts: "Drafts" },
    }
  );
  await insertInboxFolder(trx, { orgId }, mailboxId);
  return { orgId, userId, mailboxId };
}

export async function insertTestEmail(
  trx: Transaction<DB>,
  ctx: { orgId: string },
  mailboxId: string,
  overrides?: Partial<NewEmail> & {
    status?: string;
    attempts?: number;
    next_attempt_at?: Date | null;
    locked_at?: Date | null;
    backfilled_at?: Date | null;
  }
): Promise<string> {
  const row = await trx
    .insertInto("emails")
    .values({
      org_id: ctx.orgId,
      mailbox_id: mailboxId,
      dedup_key: `test:${randomUUID()}`,
      thread_key: `test:${randomUUID()}`,
      content_hash: "h",
      uid: 1,
      received_at: new Date(),
      status: "pending",
      ...overrides,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// Other tests and dev data leave active mailboxes in the DB; the job tests want only their own. The rollback undoes it.
export async function pauseOtherMailboxes(trx: Transaction<DB>): Promise<void> {
  await trx.updateTable("mailboxes").set({ status: "paused" }).where("status", "=", "active").execute();
}

// A new user with a membership in the org; returns the user id.
export async function addMember(
  trx: Transaction<DB>,
  orgId: string,
  role: MembershipRole = "assistant"
): Promise<string> {
  const user = await insertUser(trx, { email: `member-${randomUUID()}@x.test`, displayName: "Member" });
  await insertMembership(trx, { orgId }, { userId: user.id, role });
  return user.id;
}

export async function linkChat(
  trx: Transaction<DB>,
  ctx: TenantContext,
  userId: string,
  chatId: number,
  linkedAt: Date
): Promise<void> {
  await trx
    .insertInto("chat_links")
    .values({ org_id: ctx.orgId, user_id: userId, channel: "telegram", external_chat_id: chatId, linked_at: linkedAt })
    .execute();
}

// Between 10^9 and 10^12, so a test never collides with a real chat id in the dev DB.
export function randomChatId(): number {
  return 1_000_000_000 + Math.floor(Math.random() * (1_000_000_000_000 - 1_000_000_000));
}

// An `emails` row (status `triaged`) and a `triage_results` row with the given `created_at`; returns the e-mail id.
export async function insertTriaged(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: {
    category: Category;
    createdAt: Date;
    receivedAt?: Date;
    reason?: string | null;
    reasonCode?: string;
    confidence?: number;
    fields?: Record<string, unknown>;
    subject?: string | null;
    from?: string | null;
    messageId?: string | null;
  }
): Promise<string> {
  const emailId = await insertTestEmail(trx, ctx, mailboxId, {
    status: "triaged",
    received_at: opts.receivedAt ?? opts.createdAt,
    subject: opts.subject ?? null,
    from_address: opts.from ?? null,
    message_id_header: opts.messageId ?? null,
  });
  await trx
    .insertInto("triage_results")
    .values({
      org_id: ctx.orgId,
      email_id: emailId,
      category: opts.category,
      confidence: opts.confidence ?? 0.9,
      reason_code: opts.reasonCode ?? "direct_request",
      reason: opts.reason ?? null,
      fields: JSON.stringify(opts.fields ?? {}),
      created_at: opts.createdAt,
    })
    .execute();
  return emailId;
}

// The dev DB can hold chat links and outbox rows from manual runs; jobs that read all organizations want only their own.
// The rollback undoes it.
export async function isolateChannels(trx: Transaction<DB>): Promise<void> {
  await trx.deleteFrom("chat_links").execute();
  await trx
    .updateTable("outbox")
    .set({ status: "failed", error_code: "outdated", locked_at: null })
    .where("status", "in", ["pending", "sending"])
    .execute();
}

// One `actions` row. `applied` and `undone` rows need `applied_at`: it defaults to the row's creation time.
export async function insertAction(
  trx: Transaction<DB>,
  ctx: TenantContext,
  emailId: string,
  opts: {
    type: ActionType;
    status: string;
    payload?: Record<string, unknown>;
    idempotencyKey?: string;
    appliedAt?: Date | null;
    reversesActionId?: string | null;
    attempts?: number;
    nextAttemptAt?: Date | null;
    lockedAt?: Date | null;
    statusReason?: string | null;
    createdAt?: Date;
    dependsOnActionId?: string | null;
    providerResult?: Record<string, unknown> | null;
    approvedAt?: Date | null;
    approvedBy?: string | null;
    approvedVia?: string | null;
    notifiedAt?: Date | null;
    outgoingMessageId?: string | null;
  }
): Promise<string> {
  const createdAt = opts.createdAt ?? new Date();
  const needsAppliedAt = opts.status === "applied" || opts.status === "undone";
  const row = await trx
    .insertInto("actions")
    .values({
      org_id: ctx.orgId,
      email_id: emailId,
      type: opts.type,
      status: opts.status,
      payload: JSON.stringify(opts.payload ?? {}),
      idempotency_key: opts.idempotencyKey ?? `test:${randomUUID()}`,
      applied_at: opts.appliedAt === undefined ? (needsAppliedAt ? createdAt : null) : opts.appliedAt,
      reverses_action_id: opts.reversesActionId ?? null,
      attempts: opts.attempts ?? 0,
      next_attempt_at: opts.nextAttemptAt ?? null,
      locked_at: opts.lockedAt ?? null,
      status_reason: opts.statusReason ?? null,
      created_at: createdAt,
      depends_on_action_id: opts.dependsOnActionId ?? null,
      provider_result: opts.providerResult ? JSON.stringify(opts.providerResult) : null,
      approved_at: opts.approvedAt ?? null,
      approved_by: opts.approvedBy ?? null,
      approved_via: opts.approvedVia ?? null,
      notified_at: opts.notifiedAt ?? null,
      outgoing_message_id: opts.outgoingMessageId ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

// A triaged mail (`insertTriaged`) with its location columns and action rows; the actions are created in the given order.
export async function insertTriagedWithActions(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: Parameters<typeof insertTriaged>[3] & {
    folder?: string;
    uid?: number;
    inboxUid?: number | null;
    contentHash?: string;
    movedAt?: Date | null;
    actions: Omit<Parameters<typeof insertAction>[3], "createdAt">[];
  }
): Promise<{ emailId: string; actionIds: string[] }> {
  const { folder, uid, inboxUid, contentHash, movedAt, actions, ...triaged } = opts;
  const emailId = await insertTriaged(trx, ctx, mailboxId, triaged);
  const mailUid = uid ?? 1;
  await trx
    .updateTable("emails")
    .set({
      folder: folder ?? "INBOX",
      uid: mailUid,
      inbox_uid: inboxUid === undefined ? mailUid : inboxUid,
      content_hash: contentHash ?? "h",
      moved_at: movedAt ?? null,
    })
    .where("id", "=", emailId)
    .where("org_id", "=", ctx.orgId)
    .execute();
  const actionIds: string[] = [];
  for (const action of actions) {
    actionIds.push(await insertAction(trx, ctx, emailId, { ...action, createdAt: triaged.createdAt }));
  }
  return { emailId, actionIds };
}

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

// A triaged delegation mail with its `create_draft` and `send` rows, linked by `depends_on_action_id` (D2, D17).
// Default statuses: the draft `applied`, the send `awaiting_approval`.
export async function insertDraftAndSend(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: {
    kind?: "delegation" | "clarification" | "reminder";
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
  if (opts.delegationId !== undefined) sendPayload.delegation_id = opts.delegationId;
  if (opts.setId !== undefined) sendPayload.set_id = opts.setId;

  const emailId = await insertTriaged(trx, ctx, mailboxId, {
    category: kind === "clarification" ? "needs_reply" : "delegation",
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
  return { emailId, draftId, sendId };
}
