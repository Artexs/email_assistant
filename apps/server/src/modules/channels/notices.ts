import {
  aiTextFor,
  describeActions,
  renderAuthErrorNotice,
  renderSyncOkNotice,
  renderSyncStaleNotice,
  renderUrgentNotice,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { describeError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { listActionsForEmails } from "../actions";
import { isSyntheticMessageId, listMailboxes, type MailboxSummary } from "../mail";
import { getOrganization } from "../tenancy";
import { listTriagedBetween } from "../triage";

import type { LinkedChat } from "./port";
import { cancelPendingOutbox, insertOutbox, listLinkedChats, listSentStaleEpisodes, type NewOutboxRow } from "./repo";

const log = createLog("channels");

export const URGENT_LOOKBACK_MS = 24 * 3_600_000;
export const URGENT_LIMIT = 200;
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
  const lastGood = mailbox.last_synced_at ?? mailbox.created_at;
  const late = now.getTime() - lastGood.getTime() > SYNC_LATE_MS;

  if (late) {
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
