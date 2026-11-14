import {
  aiTextFor,
  describeActions,
  handledShare,
  isUndoable,
  mailboxModes,
  renderDigest,
  textsFor,
  type DigestItem,
  type DigestMailbox,
  type OutMessage,
  type UserLocale,
} from "@ea/core";
import { z } from "zod";

import type { Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { listActionsForEmails, listDraftTasks, listSummaries } from "../actions";
import { auditEvents, countEventsBetween } from "../audit";
import { getMailboxSettings } from "../config";
import { countOpenDelegations, listDelegateNames } from "../delegation";
import { countWaiting, INBOX, isSyntheticMessageId, listMailboxes, type TestMailRule } from "../mail";
import { getOrganization, isFeatureOn } from "../tenancy";
import { countTriagedBetween, listHandledRows, listTriagedBetween } from "../triage";

import { llmPauseToShow } from "./llm-pause";
import { lastSentDigestEnd } from "./repo";

export const DIGEST_ITEM_LIMIT = 100;
export const DIGEST_MAX_PERIOD_MS = 7 * 24 * 3_600_000;
export const FIRST_DIGEST_LOOKBACK_MS = 24 * 3_600_000;
export const WAITING_WINDOW_MS = 7 * 24 * 3_600_000;
const HANDLED_WINDOW_MS = 7 * 24 * 3_600_000;

const modeSchema = z.enum(mailboxModes);

export interface DigestRequest {
  kind: "scheduled" | "on_demand";
  periodStart: Date;
  periodEnd: Date;
  slot: { date: string; time: string; late: boolean } | null;
  now: Date;
  locale: UserLocale;
  testMail: TestMailRule;
}

// A digest that failed (never sent) does not move the start, so the next sent digest covers its mail.
export async function digestPeriodStart(
  db: Db,
  ctx: TenantContext,
  member: { userId: string; linkedAt: Date },
  now: Date
): Promise<Date> {
  const lastEnd = await lastSentDigestEnd(db, ctx, member.userId);
  const start = lastEnd ?? new Date(member.linkedAt.getTime() - FIRST_DIGEST_LOOKBACK_MS);
  const oldest = now.getTime() - DIGEST_MAX_PERIOD_MS;
  return new Date(Math.min(Math.max(start.getTime(), oldest), now.getTime()));
}

// The digest is the same for every member of the organization; only the period depends on the member.
export async function buildDigestMessage(db: Db, ctx: TenantContext, request: DigestRequest): Promise<OutMessage> {
  const organization = await getOrganization(db, ctx);
  if (organization === undefined) throw new HardError("organization not found");

  const texts = textsFor(request.locale);
  const mailboxRows = await listMailboxes(db, ctx);
  const mailboxes: DigestMailbox[] = [];
  for (const row of mailboxRows) {
    const settings = await getMailboxSettings(db, ctx, row.id);
    mailboxes.push({
      id: row.id,
      address: row.address,
      status: row.status,
      lastSyncedAt: row.last_synced_at,
      statusChangedAt: row.status_changed_at,
      mode: settings === undefined ? "none" : modeSchema.parse(settings.mode),
    });
  }

  const range = { after: request.periodStart, until: request.periodEnd };
  const rows = await listTriagedBetween(db, ctx, range, { limit: DIGEST_ITEM_LIMIT });
  const counts = await countTriagedBetween(db, ctx, range);

  const actions = await listActionsForEmails(
    db,
    ctx,
    rows.map((row) => row.email_id),
    request.now
  );
  const summaries = await listSummaries(
    db,
    ctx,
    rows.filter((row) => row.category === "info").map((row) => row.email_id)
  );

  const delegateIds = new Set<string>();
  for (const list of actions.values()) {
    for (const action of list) {
      if (action.delegateId !== null) delegateIds.add(action.delegateId);
    }
  }
  const names = await listDelegateNames(db, ctx, [...delegateIds]);
  const tasks = await listDraftTasks(
    db,
    ctx,
    rows.filter((row) => row.category === "delegation").map((row) => row.email_id)
  );
  const delegations = await countOpenDelegations(db, ctx);

  const items: DigestItem[] = rows.map((row) => ({
    emailId: row.email_id,
    category: row.category,
    from: row.from_address,
    subject: row.subject,
    receivedAt: row.received_at,
    synthetic: isSyntheticMessageId(row.message_id_header),
    folderTag: row.source_folder === INBOX ? null : row.source_folder,
    aiText: aiTextFor(
      {
        category: row.category,
        reasonCode: row.reason_code,
        reason: row.reason,
        summary: summaries.get(row.email_id) ?? null,
        modelCategory: row.model_category,
        confidence: row.confidence,
        task: tasks.get(row.email_id) ?? null,
      },
      texts
    ),
    wouldDo: describeActions(actions.get(row.email_id) ?? [], names, { stayFolder: row.folder }, texts),
    undoable: isUndoable(actions.get(row.email_id) ?? [], request.now),
  }));

  const skippedTooOld = await countEventsBetween(db, ctx, auditEvents.emailSkipped, range, { reasonCode: "too_old" });
  const skippedBacklog = await countEventsBetween(db, ctx, auditEvents.emailSkipped, range, {
    reasonCode: "suspended_backlog",
  });
  const waiting = await countWaiting(db, ctx, { receivedSince: new Date(request.now.getTime() - WAITING_WINDOW_MS) });
  const llmPause = await llmPauseToShow(db, ctx, request.now);
  // The handled share of the last 7 days, behind the flag `handled_share`.
  const handled = (await isFeatureOn(db, ctx, "handled_share"))
    ? handledShare(
        await listHandledRows(db, ctx, {
          range: { start: new Date(request.now.getTime() - HANDLED_WINDOW_MS), end: request.now },
          mailboxId: null,
          testMail: request.testMail,
        })
      )
    : null;

  return renderDigest(
    {
      kind: request.kind,
      now: request.now,
      timeZone: organization.timezone,
      slot: request.slot,
      periodStart: request.periodStart,
      mailboxes,
      counts,
      items,
      skippedTooOld,
      skippedBacklog,
      waiting,
      delegations,
      ...(llmPause === null ? {} : { llmPause }),
      ...(handled === null
        ? {}
        : { handled: { ...handled, shadowOnly: mailboxes.every((mailbox) => mailbox.mode === "shadow") } }),
    },
    texts
  );
}
