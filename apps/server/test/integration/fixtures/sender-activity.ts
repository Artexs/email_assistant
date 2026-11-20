import { randomUUID } from "node:crypto";

import {
  encodeNoticeView,
  noticeChannels,
  noticeDetails,
  noticeKindSchema,
  outButtonsSchema,
  renderNotice,
  sendPayloadFor,
  userLocaleSchema,
  type ActionType,
  type Category,
  type DraftPayload,
  type MembershipRole,
  type OutMessage,
} from "@ea/core";
import type { Transaction } from "kysely";
import { z } from "zod";

import { noDelegationHooks, type ApplyDeps } from "../../src/modules/actions";
import { composeMessage, type MailCapabilities, type NewEmail } from "../../src/modules/mail";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { createOrganizationWithOwner } from "../../src/modules/tenancy";
import { insertMembership, insertUser } from "../../src/modules/tenancy/repo";
import type { SuspiciousContext } from "../../src/modules/triage";
import type { DB, TenantContext } from "../../src/platform/db";

export const testCapabilities: MailCapabilities = {
  idle: true,
  move: true,
  uidplus: true,
  condstore: true,
  specialUse: true,
  keywords: true,
};

// The send fields of `ApplyDeps` for tests that apply no draft or send.
export function applyDepsDefaults(): Pick<
  ApplyDeps,
  "mailbox" | "owner" | "organization" | "compose" | "sender" | "hooks" | "appendFolders"
> {
  return {
    mailbox: { address: "box@x.test", capabilities: { uidplus: true }, folderMap: {} },
    owner: { displayName: "Owner" },
    organization: { styleText: null, timezone: "Europe/Warsaw" },
    compose: composeMessage,
    sender: null,
    hooks: noDelegationHooks,
    appendFolders: new Set(),
  };
}

// Fixture users read English, so the text assertions keep their meaning; channels-locale.test.ts covers pl and null.
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
    locale: "en",
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
    created_at?: Date;
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

// The `email_headers` row of a mail with the captured attachments. `count` defaults to the list length.
export async function insertAttachmentHeaders(
  trx: Transaction<DB>,
  ctx: { orgId: string },
  emailId: string,
  attachments: { name: string | null; type: string; size: number; inline: boolean }[],
  count: number = attachments.length
): Promise<void> {
  await trx
    .insertInto("email_headers")
    .values({
      email_id: emailId,
      org_id: ctx.orgId,
      attachments: JSON.stringify(attachments),
      attachment_count: count,
      parts_known: true,
      captured_at: new Date(),
    })
    .execute();
}

// Other tests and dev data leave active mailboxes in the DB; the job tests want only their own. The rollback undoes it.
export async function pauseOtherMailboxes(trx: Transaction<DB>): Promise<void> {
  await trx.updateTable("mailboxes").set({ status: "paused" }).where("status", "=", "active").execute();
}

// The plan state of the tests: a direct update, as the CLI's service does it (the hooks are not part of these tests).
export async function suspendOrg(trx: Transaction<DB>, orgId: string): Promise<void> {
  await trx.updateTable("organizations").set({ plan: "suspended" }).where("id", "=", orgId).execute();
}

export async function resumeOrg(trx: Transaction<DB>, orgId: string, at: Date): Promise<void> {
  await trx.updateTable("organizations").set({ plan: "active", resumed_at: at }).where("id", "=", orgId).execute();
}

// A new user with a membership in the org; returns the user id.
export async function addMember(
  trx: Transaction<DB>,
  orgId: string,
  role: MembershipRole = "assistant"
): Promise<string> {
  const user = await insertUser(trx, {
    email: `member-${randomUUID()}@x.test`,
    displayName: "Member",
    locale: "en",
  });
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
    // The `suspicious_reasons` of the result row (default none) and the thread of the mail (default a new thread).
    suspiciousReasons?: readonly string[];
    threadKey?: string;
  }
): Promise<string> {
  const emailId = await insertTestEmail(trx, ctx, mailboxId, {
    ...(opts.threadKey === undefined ? {} : { thread_key: opts.threadKey }),
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
      suspicious_reasons: [...(opts.suspiciousReasons ?? [])],
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
    lastError?: string | null;
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
      last_error: opts.lastError ?? null,
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
    sourceFolder?: string;
    uid?: number;
    sourceUid?: number | null;
    contentHash?: string;
    movedAt?: Date | null;
    actions: Omit<Parameters<typeof insertAction>[3], "createdAt">[];
  }
): Promise<{ emailId: string; actionIds: string[] }> {
  const { folder, sourceFolder, uid, sourceUid, contentHash, movedAt, actions, ...triaged } = opts;
  const emailId = await insertTriaged(trx, ctx, mailboxId, triaged);
  const mailUid = uid ?? 1;
  await trx
    .updateTable("emails")
    .set({
      folder: folder ?? "INBOX",
      source_folder: sourceFolder ?? "INBOX",
      uid: mailUid,
      source_uid: sourceUid === undefined ? mailUid : sourceUid,
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

// The message a row stands for: its sent text, or the render of its view (as the sender makes it).
export function renderedOf(row: {
  kind: string;
  view: unknown;
  channel: string;
  detail: string;
  locale: string;
  text: string | null;
  buttons: unknown;
}): OutMessage {
  if (row.text !== null) return { text: row.text, buttons: outButtonsSchema.parse(row.buttons) };
  const rendered = renderNotice(noticeKindSchema.parse(row.kind), row.view, {
    channel: z.enum(noticeChannels).parse(row.channel),
    detail: z.enum(noticeDetails).parse(row.detail),
    locale: userLocaleSchema.parse(row.locale),
  });
  if (!rendered.ok) throw new Error("view does not render");
  return rendered.message;
}

// A valid view of the kind whose rendered text holds the marker; for rows that only need a text to read or send.
export function testNoticeView(
  kind: "urgent" | "digest" | "approval" | "approval_set",
  input: { marker: string; emailId?: string; at: Date }
): Record<string, unknown> {
  const timeZone = "Europe/Warsaw";
  switch (kind) {
    case "urgent":
      if (input.emailId === undefined) throw new Error("urgent view needs an email id");
      return encodeNoticeView("urgent", {
        emailId: input.emailId,
        from: "sender@example.test",
        subject: input.marker,
        ai: { reasonCode: "llm", reason: null },
        receivedAt: input.at,
        synthetic: false,
        folderTag: null,
        actions: [],
        delegateNames: {},
        stayFolder: "INBOX",
        now: input.at,
        timeZone,
      });
    case "digest":
      return encodeNoticeView("digest", { text: input.marker, buttons: [[{ text: "OK", data: "ok" }]] });
    case "approval":
      return encodeNoticeView("approval", {
        actionId: randomUUID(),
        view: {
          kind: "delegation",
          recipient: { name: null, address: "delegate@example.test" },
          sender: null,
          recipientInactive: false,
          subject: input.marker,
          dueDate: null,
          body: "Body",
          quote: null,
          synthetic: false,
        },
        now: input.at,
        timeZone,
      });
    case "approval_set":
      return encodeNoticeView("approval_set", {
        setId: randomUUID(),
        items: [
          {
            n: 1,
            delegateName: "Anna",
            address: "delegate@example.test",
            subject: input.marker,
            dueAt: null,
            reminder: 1,
            task: "Task",
          },
        ],
        timeZone,
      });
  }
}

// A suspicious context with no known sender, no known domain and no trusted header: no rule can fire. For tests that do not read reasons.
export const noSuspiciousContext: SuspiciousContext = {
  isKnown: () => false,
  knownDomains: [],
  sentDomains: [],
  protectedNames: [],
  trustedAuthservIds: [],
};

// One incoming mail of a sender spec and the rows that hang on it (all optional).
export interface SeededMail {
  // The `received_at` of the mail.
  at: Date;
  // Default: a fresh Message-ID.
  messageId?: string;
  inReplyTo?: string;
  // The newest triage result of the mail.
  category?: Category;
  suspicious?: boolean;
  answered?: boolean;
  flagged?: boolean;
  seen?: boolean;
  // The captured headers. `cleared` sets `texts_cleared_at`, as the retention does.
  headers?: { listId?: string; listUnsubscribe?: string; autoSubmitted?: string; cleared?: boolean };
  // Feedback rows in order; each is newer than the one before it.
  feedback?: { verdict: "right" | "wrong"; trueCategory?: Category; source?: "web" | "imap_move" | "undo" }[];
  // A test mail (synthetic Message-ID).
  test?: boolean;
}

// One Sent row of the user (or a system send).
export interface SeededSent {
  // The `sent_at` and `internal_date`.
  at: Date;
  to?: string[];
  cc?: string[];
  // Default: a fresh Message-ID.
  messageId?: string;
  // The Message-ID of the mail that this Sent mail answers.
  parent?: string;
  from?: string;
  autoSubmitted?: string;
  // A send of the assistant: the row has an action id and no text.
  system?: boolean;
}

export interface SenderActivitySpec {
  // The From address of the mails. Optional: a spec can hold Sent mail only.
  address?: string;
  mails?: SeededMail[];
  sent?: SeededSent[];
}

// The source rows that one sender leaves in a mailbox: incoming mail with its triage result, flags, captured headers and
// feedback, and Sent mail of the user. The unit of time is the caller's: every date comes from the spec. Returns the ids.
export async function seedSenderActivity(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  spec: SenderActivitySpec
): Promise<{ emailIds: string[]; sentIds: string[] }> {
  const emailIds: string[] = [];
  for (const mail of spec.mails ?? []) {
    const id = await insertTestEmail(trx, ctx, mailboxId, {
      status: mail.category === undefined ? "pending" : "triaged",
      received_at: mail.at,
      from_address: spec.address ?? null,
      message_id_header:
        mail.test === true ? `<${randomUUID()}@ea-seed.test>` : (mail.messageId ?? `<${randomUUID()}@x.test>`),
      in_reply_to: mail.inReplyTo ?? null,
    });
    emailIds.push(id);
    if (mail.category !== undefined) {
      await trx
        .insertInto("triage_results")
        .values({
          org_id: ctx.orgId,
          email_id: id,
          category: mail.category,
          confidence: 0.9,
          reason_code: "direct_request",
          suspicious_reasons: mail.suspicious === true ? ["lookalike_domain"] : [],
          created_at: mail.at,
        })
        .execute();
    }
    if (mail.answered !== undefined || mail.flagged !== undefined || mail.seen !== undefined) {
      await trx
        .insertInto("email_flags")
        .values({
          email_id: id,
          org_id: ctx.orgId,
          seen: mail.seen ?? true,
          answered: mail.answered ?? false,
          flagged: mail.flagged ?? false,
          checked_at: mail.at,
        })
        .execute();
    }
    if (mail.headers !== undefined) {
      await trx
        .insertInto("email_headers")
        .values({
          email_id: id,
          org_id: ctx.orgId,
          list_id: mail.headers.listId ?? null,
          list_unsubscribe: mail.headers.listUnsubscribe ?? null,
          auto_submitted: mail.headers.autoSubmitted ?? null,
          parts_known: true,
          captured_at: mail.at,
          texts_cleared_at: mail.headers.cleared === true ? mail.at : null,
        })
        .execute();
    }
    let step = 0;
    for (const item of mail.feedback ?? []) {
      step += 1;
      await trx
        .insertInto("triage_feedback")
        .values({
          org_id: ctx.orgId,
          email_id: id,
          verdict: item.verdict,
          true_category: item.trueCategory ?? null,
          source: item.source ?? "web",
          created_at: new Date(mail.at.getTime() + step * 1000),
        })
        .execute();
    }
  }

  const sentIds: string[] = [];
  for (const sent of spec.sent ?? []) {
    const row = await trx
      .insertInto("sent_emails")
      .values({
        org_id: ctx.orgId,
        mailbox_id: mailboxId,
        dedup_key: `mid:${randomUUID()}`,
        path: "Sent",
        uidvalidity: "7",
        uid: "1",
        message_id: sent.messageId ?? `<${randomUUID()}@x.test>`,
        parent_message_id: sent.parent ?? null,
        thread_key: `test:${randomUUID()}`,
        from_address: sent.from ?? null,
        to_addresses: sent.to ?? (spec.address === undefined ? [] : [spec.address]),
        cc_addresses: sent.cc ?? [],
        auto_submitted: sent.autoSubmitted ?? null,
        origin: sent.system === true ? "system" : "user",
        action_id: sent.system === true ? randomUUID() : null,
        content: "headers_only",
        sent_at: sent.at,
        internal_date: sent.at,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    sentIds.push(row.id);
  }
  return { emailIds, sentIds };
}
