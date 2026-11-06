import {
  aiTextFor,
  describeActions,
  mailboxModes,
  renderDigest,
  type DigestItem,
  type DigestMailbox,
  type OutMessage,
} from "@ea/core";
import { z } from "zod";

import type { Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { listActionsForEmails, listSummaries } from "../actions";
import { auditEvents, countEventsBetween } from "../audit";
import { getMailboxSettings } from "../config";
import { countWaiting, isSyntheticMessageId, listMailboxes } from "../mail";
import { getOrganization } from "../tenancy";
import { countTriagedBetween, listTriagedBetween } from "../triage";

import { lastSentDigestEnd } from "./repo";

export const DIGEST_ITEM_LIMIT = 100;
export const DIGEST_MAX_PERIOD_MS = 7 * 24 * 3_600_000;
export const FIRST_DIGEST_LOOKBACK_MS = 24 * 3_600_000;
export const WAITING_WINDOW_MS = 7 * 24 * 3_600_000;

const modeSchema = z.enum(mailboxModes);

export interface DigestRequest {
  kind: "scheduled" | "on_demand";
  periodStart: Date;
  periodEnd: Date;
  slot: { date: string; time: string; late: boolean } | null;
  now: Date;
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
      mode: settings === undefined ? "shadow" : modeSchema.parse(settings.mode),
    });
  }

  const range = { after: request.periodStart, until: request.periodEnd };
  const rows = await listTriagedBetween(db, ctx, range, { limit: DIGEST_ITEM_LIMIT });
  const counts = await countTriagedBetween(db, ctx, range);

  const actions = await listActionsForEmails(
    db,
    ctx,
    rows.map((row) => row.email_id)
  );
  const summaries = await listSummaries(
    db,
    ctx,
    rows.filter((row) => row.category === "info").map((row) => row.email_id)
  );

  const items: DigestItem[] = rows.map((row) => ({
    emailId: row.email_id,
    category: row.category,
    from: row.from_address,
    subject: row.subject,
    receivedAt: row.received_at,
    synthetic: isSyntheticMessageId(row.message_id_header),
    aiText: aiTextFor({
      category: row.category,
      reasonCode: row.reason_code,
      reason: row.reason,
      summary: summaries.get(row.email_id) ?? null,
      modelCategory: row.model_category,
      confidence: row.confidence,
    }),
    wouldDo: describeActions(actions.get(row.email_id) ?? []),
  }));

  const skippedTooOld = await countEventsBetween(db, ctx, auditEvents.emailSkipped, range);
  const waiting = await countWaiting(db, ctx, { receivedSince: new Date(request.now.getTime() - WAITING_WINDOW_MS) });

  return renderDigest({
    kind: request.kind,
    now: request.now,
    timeZone: organization.timezone,
    slot: request.slot,
    periodStart: request.periodStart,
    mailboxes,
    counts,
    items,
    skippedTooOld,
    waiting,
  });
}
