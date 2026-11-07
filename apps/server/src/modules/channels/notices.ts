import {
  AI_FOLDER_NAMES,
  aiTextFor,
  approvalViewOf,
  buildOutgoingMessage,
  describeActions,
  draftPayloadSchema,
  isExternalSender,
  MAILBOX_ACTION_TYPES,
  matchSender,
  outgoingSubject,
  renderActionFailedNotice,
  renderApprovalRequest,
  renderApprovalSetRequest,
  renderAuthErrorNotice,
  renderDelegationAnswered,
  renderSendResult,
  renderSyncOkNotice,
  renderSyncStaleNotice,
  renderUrgentNotice,
  type ApprovalView,
  type DraftPayload,
  type SendResultKind,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { describeError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import {
  draftHasReverse,
  getDraft,
  listActionsForEmails,
  listFailedUnnotified,
  listSendResultsToNotify,
  listSendsToNotify,
  listSetsToNotify,
  markNotified,
  markResultNotified,
  SENT_COPY_PENDING_MAX_AGE_MS,
  type SendRow,
} from "../actions";
import { auditEvents, findActionActor } from "../audit";
import { listSenderRules } from "../config";
import {
  getDelegate,
  getDelegation,
  listAnsweredUnnotified,
  listDelegateAddresses,
  listDelegateNames,
  markAnsweredNotified,
} from "../delegation";
import { getEmailMeta, getMailbox, isSyntheticMessageId, listMailboxes, type MailboxSummary } from "../mail";
import { getOrganization, listMemberships } from "../tenancy";
import { listTriagedBetween } from "../triage";

import type { LinkedChat } from "./port";
import { cancelPendingOutbox, insertOutbox, listLinkedChats, listSentStaleEpisodes, type NewOutboxRow } from "./repo";

const log = createLog("channels");

export const URGENT_LOOKBACK_MS = 24 * 3_600_000;
export const URGENT_LIMIT = 200;
export const ACTION_FAILED_LOOKBACK_MS = 24 * 3_600_000;
export const ACTION_FAILED_LIMIT = 50;
export const SYNC_LATE_MS = 30 * 60_000;
export const STALE_GRACE_AFTER_START_MS = 10 * 60_000;
export const APPROVAL_LIMIT = 50;

export interface NoticeDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  // The process start time (from `main.ts`).
  startedAt: Date;
}

type DbOrTrx = Db | Transaction<DB>;

// A row that fails every tick warns once per process, not every 15 s.
const warnedRows = new Set<string>();

function warnSkipped(kind: string, id: string, error: unknown): void {
  const key = `${kind}:${id}`;
  if (warnedRows.has(key)) return;
  warnedRows.add(key);
  log.warn(`notice ${kind} ${id}: skipped: ${describeError(error)}`);
}

function inTransaction<T>(db: DbOrTrx, run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : (db as Db).transaction().execute(run);
}

async function queue(
  db: DbOrTrx,
  ctx: TenantContext,
  row: Omit<NewOutboxRow, "createdAt" | "nextAttemptAt">,
  now: Date
): Promise<void> {
  const id = await insertOutbox(db, ctx, { ...row, createdAt: now, nextAttemptAt: now });
  if (id !== null) log.info(`notice ${row.kind} queued: outbox ${id}`);
}

// D13: every linked member gets an urgent notice for mail that was triaged after the link.
async function detectUrgent(
  db: DbOrTrx,
  ctx: TenantContext,
  members: LinkedChat[],
  pausedMailboxIds: Set<string>,
  timeZone: string,
  now: Date
): Promise<void> {
  const lookbackStart = now.getTime() - URGENT_LOOKBACK_MS;
  const sinceOf = (member: LinkedChat) => Math.max(member.linkedAt.getTime(), lookbackStart);
  const earliest = Math.min(...members.map(sinceOf));
  const rows = (
    await listTriagedBetween(
      db,
      ctx,
      { after: new Date(earliest - 1), until: now },
      { limit: URGENT_LIMIT, categories: ["urgent"] }
    )
  ).filter((row) => !pausedMailboxIds.has(row.mailbox_id));
  if (rows.length === 0) return;
  const actions = await listActionsForEmails(
    db,
    ctx,
    rows.map((row) => row.email_id)
  );
  const delegateIds = new Set<string>();
  for (const list of actions.values()) {
    for (const action of list) {
      if (action.delegateId !== null) delegateIds.add(action.delegateId);
    }
  }
  const names = await listDelegateNames(db, ctx, [...delegateIds]);
  for (const member of members) {
    const since = sinceOf(member);
    for (const row of rows) {
      if (row.triaged_at.getTime() < since) continue;
      await queue(
        db,
        ctx,
        {
          userId: member.userId,
          kind: "urgent",
          dedupKey: `urgent:${row.email_id}`,
          emailId: row.email_id,
          message: renderUrgentNotice({
            emailId: row.email_id,
            from: row.from_address,
            subject: row.subject,
            aiText: aiTextFor({
              category: "urgent",
              reasonCode: row.reason_code,
              reason: row.reason,
              summary: null,
              modelCategory: row.model_category,
              confidence: row.confidence,
            }),
            receivedAt: row.received_at,
            synthetic: isSyntheticMessageId(row.message_id_header),
            wouldDo: describeActions(actions.get(row.email_id) ?? [], names),
            now,
            timeZone,
          }),
        },
        now
      );
    }
  }
}

function isMailboxActionType(type: string): type is (typeof MAILBOX_ACTION_TYPES)[number] {
  return (MAILBOX_ACTION_TYPES as readonly string[]).includes(type);
}

// D11: owners get one notice per failed action; the dedup key and `notified_at` keep it single.
async function detectActionFailed(db: DbOrTrx, ctx: TenantContext, owners: LinkedChat[], now: Date): Promise<void> {
  const failed = await listFailedUnnotified(db, ctx, { limit: ACTION_FAILED_LIMIT });
  for (const action of failed) {
    const run = async (trx: DbOrTrx) => {
      if (
        (isMailboxActionType(action.type) || (action.type === "create_draft" && action.reverse)) &&
        action.updated_at.getTime() >= now.getTime() - ACTION_FAILED_LOOKBACK_MS
      ) {
        const key = typeof action.payload.folder === "string" ? action.payload.folder : undefined;
        const folderName =
          action.type === "move" && key !== undefined && Object.hasOwn(AI_FOLDER_NAMES, key)
            ? AI_FOLDER_NAMES[key as keyof typeof AI_FOLDER_NAMES]
            : null;
        const reason =
          action.type !== "create_draft" &&
          (action.status_reason === "mail_not_found" || action.status_reason === "bad_payload")
            ? action.status_reason
            : "other";
        const message = renderActionFailedNotice({
          actionType: action.type,
          reverse: action.reverse,
          reason,
          folderName,
          from: action.from_address,
          subject: action.subject,
          synthetic: isSyntheticMessageId(action.message_id_header),
          attempts: action.attempts,
        });
        for (const owner of owners) {
          await queue(
            trx,
            ctx,
            {
              userId: owner.userId,
              kind: "action_failed",
              dedupKey: `action_failed:${action.id}`,
              emailId: action.email_id,
              message,
            },
            now
          );
        }
      }
      await markNotified(trx, ctx, action.id, now);
    };
    await (db.isTransaction ? run(db) : (db as Db).transaction().execute(run));
  }
}

async function detectAuthError(
  db: DbOrTrx,
  ctx: TenantContext,
  owners: LinkedChat[],
  mailbox: MailboxSummary,
  timeZone: string,
  now: Date
): Promise<void> {
  if (mailbox.status !== "auth_error") {
    await cancelPendingOutbox(db, ctx, { kind: "auth_error", mailboxId: mailbox.id });
    return;
  }
  const key = `auth_error:${mailbox.id}:${mailbox.status_changed_at.getTime()}`;
  for (const owner of owners) {
    await queue(
      db,
      ctx,
      {
        userId: owner.userId,
        kind: "auth_error",
        dedupKey: key,
        mailboxId: mailbox.id,
        message: renderAuthErrorNotice({
          address: mailbox.address,
          mailboxId: mailbox.id,
          since: mailbox.status_changed_at,
          now,
          timeZone,
        }),
      },
      now
    );
  }
  await cancelPendingOutbox(db, ctx, { kind: "auth_error", mailboxId: mailbox.id, exceptDedupKey: key });
}

async function detectSync(
  deps: NoticeDeps,
  ctx: TenantContext,
  members: LinkedChat[],
  owners: LinkedChat[],
  mailbox: MailboxSummary,
  timeZone: string,
  now: Date
): Promise<void> {
  const { db } = deps;
  if (mailbox.status !== "active") {
    await cancelPendingOutbox(db, ctx, { kind: "sync_stale", mailboxId: mailbox.id });
    return;
  }
  const within = (at: Date) => now.getTime() - at.getTime() <= SYNC_LATE_MS;
  const fresh = mailbox.last_synced_at !== null && within(mailbox.last_synced_at);
  // The mailbox became active again (resume, new password) or is new: give the sync time to run.
  const grace = within(mailbox.status_changed_at) || (mailbox.last_synced_at === null && within(mailbox.created_at));

  if (!fresh) {
    if (grace) {
      await cancelPendingOutbox(db, ctx, { kind: "sync_stale", mailboxId: mailbox.id });
      return;
    }
    if (now.getTime() - deps.startedAt.getTime() < STALE_GRACE_AFTER_START_MS) return;
    const key = `sync_stale:${mailbox.id}:${mailbox.last_synced_at?.getTime() ?? "never"}`;
    for (const owner of owners) {
      await queue(
        db,
        ctx,
        {
          userId: owner.userId,
          kind: "sync_stale",
          dedupKey: key,
          mailboxId: mailbox.id,
          message: renderSyncStaleNotice({
            address: mailbox.address,
            lastSyncedAt: mailbox.last_synced_at,
            now,
            timeZone,
          }),
        },
        now
      );
    }
    await cancelPendingOutbox(db, ctx, { kind: "sync_stale", mailboxId: mailbox.id, exceptDedupKey: key });
    return;
  }

  await cancelPendingOutbox(db, ctx, { kind: "sync_stale", mailboxId: mailbox.id });
  if (mailbox.last_synced_at === null) return;
  const memberIds = new Set(members.map((member) => member.userId));
  for (const { userId, episode } of await listSentStaleEpisodes(db, ctx, mailbox.id)) {
    if (!memberIds.has(userId)) continue;
    await queue(
      db,
      ctx,
      {
        userId,
        kind: "sync_ok",
        dedupKey: `sync_ok:${mailbox.id}:${episode}`,
        mailboxId: mailbox.id,
        message: renderSyncOkNotice({
          address: mailbox.address,
          lastSyncedAt: mailbox.last_synced_at,
          now,
          timeZone,
        }),
      },
      now
    );
  }
}

// D19: the text the owner sees is the text the committer sends (same builder, same inputs).
export async function approvalViewFor(
  db: DbOrTrx,
  ctx: TenantContext,
  send: SendRow
): Promise<{ view: ApprovalView; subject: string }> {
  if (send.depends_on_action_id === null) throw new Error("send has no draft");
  const draftRow = await getDraft(db, ctx, send.depends_on_action_id);
  if (draftRow === undefined) throw new Error("draft not found");
  const draft = draftPayloadSchema.parse(draftRow.payload);
  const mailbox = await getMailbox(db, ctx, send.email.mailbox_id);
  if (mailbox === undefined) throw new Error("mailbox not found");
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) throw new Error("organization not found");
  const owner = (await listMemberships(db, ctx)).find((member) => member.role === "owner");
  const { email } = send;
  const original = {
    fromAddress: email.from_address,
    subject: email.subject,
    receivedAt: email.received_at,
    messageId: email.message_id_header,
    inReplyTo: email.in_reply_to,
    references: email.references_header?.split(/\s+/).filter((id) => id !== "") ?? [],
    bodyText: email.body_text,
  };
  const message = buildOutgoingMessage({
    draft,
    draftActionId: draftRow.id,
    createdAt: draftRow.created_at,
    mailbox: { address: mailbox.address },
    owner: { displayName: owner?.display_name ?? mailbox.address },
    organization: { styleText: organization.style_text, timezone: organization.timezone },
    original,
  });
  const match = matchSender(email.from_address, await listSenderRules(db, ctx, mailbox.id));
  const internalAddresses = [
    ...(await listMailboxes(db, ctx)).map((box) => box.address),
    ...(await listDelegateAddresses(db, ctx, { activeOnly: true })),
  ];
  const external = isExternalSender(email.from_address, {
    internalAddresses,
    whitelisted: match.whitelisted,
    vip: match.vip,
  });
  const delegate = "delegate_id" in draft ? await getDelegate(db, ctx, draft.delegate_id) : undefined;
  const view = approvalViewOf(message, {
    draft,
    original,
    external,
    synthetic: isSyntheticMessageId(email.message_id_header),
    recipientInactive: delegate !== undefined && !delegate.active,
  });
  return { view, subject: message.subject };
}

// D19: one request per owner for each send that waits, after its draft is applied. No owner: nothing is queued or marked.
async function detectApprovals(
  db: DbOrTrx,
  ctx: TenantContext,
  owners: LinkedChat[],
  timeZone: string,
  now: Date
): Promise<void> {
  if (owners.length === 0) return;
  for (const row of await listSendsToNotify(db, ctx, { limit: APPROVAL_LIMIT })) {
    try {
      const { view } = await approvalViewFor(db, ctx, row);
      const message = renderApprovalRequest({ actionId: row.id, view, now, timeZone });
      await inTransaction(db, async (trx) => {
        for (const owner of owners) {
          await queue(
            trx,
            ctx,
            {
              userId: owner.userId,
              kind: "approval",
              dedupKey: `approval:${row.id}`,
              emailId: row.email_id,
              message,
            },
            now
          );
        }
        await markNotified(trx, ctx, row.id, now);
      });
    } catch (error) {
      warnSkipped("approval", row.id, error);
    }
  }
}

// D21: one request per owner for a whole reminder set.
async function detectApprovalSets(
  db: DbOrTrx,
  ctx: TenantContext,
  owners: LinkedChat[],
  timeZone: string,
  now: Date
): Promise<void> {
  if (owners.length === 0) return;
  for (const [setId, sends] of await listSetsToNotify(db, ctx, { limit: APPROVAL_LIMIT })) {
    try {
      const first = sends[0];
      if (first === undefined) continue;
      const items = [];
      for (const [index, send] of sends.entries()) {
        const draftRow =
          send.depends_on_action_id === null ? undefined : await getDraft(db, ctx, send.depends_on_action_id);
        if (draftRow === undefined) throw new Error("draft not found");
        const draft: DraftPayload = draftPayloadSchema.parse(draftRow.payload);
        if (draft.kind !== "reminder") throw new Error("set draft is not a reminder");
        const delegation = await getDelegation(db, ctx, draft.delegation_id);
        items.push({
          n: index + 1,
          delegateName: draft.delegate_name,
          address: draft.to[0] ?? "",
          subject: send.email.subject,
          dueAt: delegation?.due_at ?? null,
          reminder: draft.reminder,
          task: draft.task,
        });
      }
      const message = renderApprovalSetRequest({ setId, items, timeZone });
      await inTransaction(db, async (trx) => {
        for (const owner of owners) {
          await queue(
            trx,
            ctx,
            {
              userId: owner.userId,
              kind: "approval_set",
              dedupKey: `approval_set:${setId}`,
              emailId: first.email_id,
              message,
            },
            now
          );
        }
        for (const send of sends) await markNotified(trx, ctx, send.id, now);
      });
    } catch (error) {
      warnSkipped("approval_set", setId, error);
    }
  }
}

const SEND_KINDS: readonly DraftPayload["kind"][] = ["delegation", "clarification", "reminder"];
const EXPIRY_REASONS = [
  "timeout",
  "draft_missing",
  "not_notified",
  "held_timeout",
  "delegation_closed",
  "policy_changed",
] as const;

function stringOf(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

async function resultKindOf(
  db: DbOrTrx,
  ctx: TenantContext,
  row: SendRow,
  draftRemoved: boolean,
  names: ReadonlyMap<string, string>
): Promise<SendResultKind> {
  const result = row.provider_result ?? {};
  switch (row.status) {
    case "applied": {
      const copy = result.sent_copy;
      // A copy still `pending` here is older than the wait: the copy step died.
      return { kind: "sent", sentCopy: copy === "appended" || copy === "found" ? copy : "failed", draftRemoved };
    }
    case "failed": {
      const stage = stringOf(result.stage);
      const code = numberOf(result.response_code) ?? stringOf(result.code);
      switch (row.status_reason) {
        case "smtp_rejected":
          return {
            kind: "rejected_by_server",
            stage: stage ?? "unknown",
            responseCode: numberOf(result.response_code),
          };
        case "outcome_unknown":
          return { kind: "outcome_unknown" };
        case "bad_payload":
          return { kind: "failed", cause: "bad_payload", code: null, tries: row.attempts };
        default: {
          const cause = stage === "content" ? "content_soft" : stage === "compose" ? "compose" : "tries";
          return { kind: "failed", cause, code: code === null ? null : String(code), tries: row.attempts };
        }
      }
    }
    case "expired": {
      const reason = EXPIRY_REASONS.find((known) => known === row.status_reason);
      if (reason === undefined) throw new Error("unknown expiry reason");
      return { kind: "expired", reason, draftRemoved };
    }
    default: {
      const actor = await findActionActor(db, ctx, row.id, auditEvents.actionRejected);
      return { kind: "rejected", byName: actor === undefined ? null : (names.get(actor) ?? null), draftRemoved };
    }
  }
}

// D20: every end state of a send gives one notice per owner. A pending Sent copy counts as lost after 10 minutes.
async function detectSendResults(db: DbOrTrx, ctx: TenantContext, owners: LinkedChat[], now: Date): Promise<void> {
  if (owners.length === 0) return;
  const rows = await listSendResultsToNotify(db, ctx, {
    limit: APPROVAL_LIMIT,
    now,
    pendingCopyMaxAgeMs: SENT_COPY_PENDING_MAX_AGE_MS,
  });
  if (rows.length === 0) return;
  const names = new Map((await listMemberships(db, ctx)).map((member) => [member.user_id, member.display_name]));
  for (const row of rows) {
    try {
      const draftRow =
        row.depends_on_action_id === null ? undefined : await getDraft(db, ctx, row.depends_on_action_id);
      const draftRemoved = draftRow !== undefined && (await draftHasReverse(db, ctx, draftRow.id));
      const sendKind = SEND_KINDS.find((known) => known === row.payload.kind) ?? "delegation";
      const to = Array.isArray(row.payload.to) ? stringOf(row.payload.to[0]) : null;
      const draftTo = Array.isArray(draftRow?.payload.to) ? stringOf(draftRow.payload.to[0]) : null;
      const message = renderSendResult({
        actionId: row.id,
        sendKind,
        result: await resultKindOf(db, ctx, row, draftRemoved, names),
        recipient: { name: stringOf(draftRow?.payload.delegate_name), address: to ?? draftTo ?? "(unknown)" },
        subject: outgoingSubject(sendKind, row.email.subject),
        synthetic: isSyntheticMessageId(row.email.message_id_header),
      });
      await inTransaction(db, async (trx) => {
        for (const owner of owners) {
          await queue(
            trx,
            ctx,
            {
              userId: owner.userId,
              kind: "send_result",
              dedupKey: `send_result:${row.id}`,
              emailId: row.email_id,
              message,
            },
            now
          );
        }
        await markResultNotified(trx, ctx, row.id, now);
      });
    } catch (error) {
      warnSkipped("send_result", row.id, error);
    }
  }
}

// D24: every linked member hears that a delegate answered.
async function detectDelegationAnswered(
  db: DbOrTrx,
  ctx: TenantContext,
  members: LinkedChat[],
  timeZone: string,
  now: Date
): Promise<void> {
  if (members.length === 0) return;
  for (const row of await listAnsweredUnnotified(db, ctx, { limit: APPROVAL_LIMIT })) {
    try {
      const answer = row.answered_email_id === null ? undefined : await getEmailMeta(db, ctx, row.answered_email_id);
      const message = renderDelegationAnswered({
        delegationId: row.id,
        delegateName: row.delegate_name,
        subject: row.subject,
        receivedAt: answer?.received_at ?? row.answered_at ?? now,
        now,
        timeZone,
        synthetic: isSyntheticMessageId(answer?.message_id_header ?? null),
      });
      await inTransaction(db, async (trx) => {
        for (const member of members) {
          await queue(
            trx,
            ctx,
            {
              userId: member.userId,
              kind: "delegation_answered",
              dedupKey: `delegation_answered:${row.id}`,
              // The delegation's own mail: the answer mail can be gone after a retention delete.
              emailId: row.email_id,
              message,
            },
            now
          );
        }
        await markAnsweredNotified(trx, ctx, row.id, now);
      });
    } catch (error) {
      warnSkipped("delegation_answered", row.id, error);
    }
  }
}

async function detectForOrg(deps: NoticeDeps, orgId: string, members: LinkedChat[], now: Date): Promise<void> {
  const { db } = deps;
  const ctx = { orgId };
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) throw new Error("organization not found");
  const timeZone = organization.timezone;
  const mailboxes = await listMailboxes(db, ctx);
  const owners = members.filter((member) => member.role === "owner");

  const pausedIds = new Set(mailboxes.filter((mailbox) => mailbox.status === "paused").map((mailbox) => mailbox.id));
  await detectUrgent(db, ctx, members, pausedIds, timeZone, now);
  await detectActionFailed(db, ctx, owners, now);
  for (const mailbox of mailboxes) {
    await detectAuthError(db, ctx, owners, mailbox, timeZone, now);
    await detectSync(deps, ctx, members, owners, mailbox, timeZone, now);
  }
  await detectApprovals(db, ctx, owners, timeZone, now);
  await detectApprovalSets(db, ctx, owners, timeZone, now);
  await detectSendResults(db, ctx, owners, now);
  await detectDelegationAnswered(db, ctx, members, timeZone, now);
}

// Never throws. One organization that fails does not stop the next one.
export async function detectNotices(deps: NoticeDeps): Promise<void> {
  try {
    const now = deps.now();
    const byOrg = new Map<string, LinkedChat[]>();
    for (const link of await listLinkedChats(deps.db)) {
      byOrg.set(link.orgId, [...(byOrg.get(link.orgId) ?? []), link]);
    }
    for (const [orgId, members] of byOrg) {
      try {
        await detectForOrg(deps, orgId, members, now);
      } catch (error) {
        log.error(`notices for org ${orgId} failed: ${describeError(error)}`);
      }
    }
  } catch (error) {
    log.error(`notices failed: ${describeError(error)}`);
  }
}
