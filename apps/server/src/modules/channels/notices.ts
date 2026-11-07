import {
  AI_FOLDER_NAMES,
  aiTextFor,
  describeActions,
  MAILBOX_ACTION_TYPES,
  renderActionFailedNotice,
  renderAuthErrorNotice,
  renderSyncOkNotice,
  renderSyncStaleNotice,
  renderUrgentNotice,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { describeError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { listActionsForEmails, listFailedUnnotified, markNotified } from "../actions";
import { isSyntheticMessageId, listMailboxes, type MailboxSummary } from "../mail";
import { getOrganization } from "../tenancy";
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

export interface NoticeDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  // The process start time (from `main.ts`).
  startedAt: Date;
}

type DbOrTrx = Db | Transaction<DB>;

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
            wouldDo: describeActions(actions.get(row.email_id) ?? []),
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
