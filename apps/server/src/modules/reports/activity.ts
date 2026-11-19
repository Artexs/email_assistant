import {
  ACTIVITY_MAX_DAYS,
  ACTIVITY_PAGE_SIZE,
  type ActivityItem,
  activityRangeMs,
  type ActivityWebPage,
  aiTextFor,
  type Category,
  type CoreTexts,
  DAY_MS,
  describeAction,
  describeActions,
  isUndoable,
} from "@ea/core";
import { z } from "zod";

import type { Db, TenantContext } from "../../platform/db";
import { listActionsForEmails, listDraftTasks, listOpenReplySendIdsOfEmails, listSummaries } from "../actions";
import { readSenderLines, type SenderLineDeps } from "../contacts";
import { listDelegateNames, listLatestDelegationsByEmailIds } from "../delegation";
import { isFeatureOn } from "../tenancy";
import { listActivityRows, listLatestFeedbackByEmailIds, suspiciousReasonsToShow } from "../triage";

const KEY_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const TEXT_PATTERN = /^[A-Za-z0-9_-]+$/;
const uuidSchema = z.uuid();

export interface ActivityCursor {
  receivedAtKey: string;
  id: string;
}

export interface ActivityQuery {
  mailboxId?: string;
  categories?: readonly Category[];
  notRated: boolean;
  since?: Date;
  cursor?: ActivityCursor;
  limit?: number;
}

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(`${cursor.receivedAtKey}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeActivityCursor(text: string): ActivityCursor | null {
  if (!TEXT_PATTERN.test(text)) return null;
  const parts = Buffer.from(text, "base64url").toString("utf8").split("|");
  if (parts.length !== 2) return null;
  const [receivedAtKey, id] = parts as [string, string];
  if (!uuidSchema.safeParse(id).success) return null;
  if (!KEY_PATTERN.test(receivedAtKey)) return null;
  const date = new Date(receivedAtKey);
  // JS rolls a date that does not exist over (02-30 becomes 03-02) and accepts year 0000; Postgres refuses both.
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.toISOString().slice(0, 19) !== receivedAtKey.slice(0, 19)
  )
    return null;
  return { receivedAtKey, id };
}

// One page of the activity list: the latest result of each mail with its actions, feedback and delegation.
// A fixed number of queries per page (at most 10; the flag read of `why_lines` makes it 11, and only when a row holds a rule),
// whatever the number of rows. `sender` (absent: no sender line) adds the flag read of `sender_context` and, with the flag on,
// ONE profile read for the whole page. The flag read of `reply_drafts` adds, with the flag on, ONE read of the open reply drafts
// of the page.
export async function listActivity(
  db: Db,
  ctx: TenantContext,
  query: ActivityQuery,
  now: Date,
  texts: CoreTexts,
  sender?: SenderLineDeps
): Promise<ActivityWebPage> {
  const limit = query.limit ?? ACTIVITY_PAGE_SIZE;
  const oldest = now.getTime() - ACTIVITY_MAX_DAYS * DAY_MS;
  const requested = query.since?.getTime() ?? now.getTime() - activityRangeMs["7d"];
  const since = new Date(Math.max(requested, oldest));

  const found = await listActivityRows(db, ctx, {
    mailboxId: query.mailboxId,
    categories: query.categories,
    notRated: query.notRated,
    since,
    cursor: query.cursor,
    limit: limit + 1,
  });
  const rows = found.slice(0, limit);
  const last = rows.at(-1);
  if (last === undefined) return { items: [], nextBefore: null };

  const ids = rows.map((row) => row.email_id);
  const actions = await listActionsForEmails(db, ctx, ids, now);
  const infoIds = rows.filter((row) => row.category === "info").map((row) => row.email_id);
  const summaries = infoIds.length === 0 ? new Map<string, string>() : await listSummaries(db, ctx, infoIds);
  const delegationIds = rows.filter((row) => row.category === "delegation").map((row) => row.email_id);
  const tasks = delegationIds.length === 0 ? new Map<string, string>() : await listDraftTasks(db, ctx, delegationIds);
  const feedback = await listLatestFeedbackByEmailIds(db, ctx, ids);
  const delegations = await listLatestDelegationsByEmailIds(db, ctx, ids);
  const suspicious = await suspiciousReasonsToShow(db, ctx, ids);
  // The rule shows only while the flag is on. A page without a rule needs no flag read.
  const whyOn = rows.some((row) => row.rule !== null) && (await isFeatureOn(db, ctx, "why_lines"));

  const delegateIds = new Set<string>();
  for (const list of actions.values()) {
    for (const action of list) {
      if (action.delegateId !== null) delegateIds.add(action.delegateId);
    }
  }
  const lines =
    sender === undefined
      ? null
      : await readSenderLines(
          sender,
          ctx,
          rows.map((row) => ({ mailboxId: row.mailbox_id, address: row.from_address })),
          now
        );

  // The key `reply` shows only while the flag is on: the row then offers "Draft reply", or links to the open draft.
  const openReplies = (await isFeatureOn(db, ctx, "reply_drafts"))
    ? await listOpenReplySendIdsOfEmails(db, ctx, ids)
    : null;

  const names = delegateIds.size === 0 ? new Map<string, string>() : await listDelegateNames(db, ctx, [...delegateIds]);

  const items = rows.map((row, index): ActivityItem => {
    const own = actions.get(row.email_id) ?? [];
    const rated = feedback.get(row.email_id);
    const delegation = delegations.get(row.email_id);
    return {
      emailId: row.email_id,
      mailboxId: row.mailbox_id,
      receivedAt: row.received_at.toISOString(),
      triagedAt: row.triaged_at.toISOString(),
      from: row.from_address,
      subject: row.subject,
      category: row.category,
      confidence: row.confidence,
      modelCategory: row.model_category,
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
      phrase: describeActions(own, names, { stayFolder: row.folder }, texts),
      actions: own
        .filter((action) => !action.reverse)
        .flatMap((action) => {
          const phrase = describeAction(action, names, texts);
          if (phrase === null) return [];
          return [
            { type: action.type, status: action.status, phrase, appliedAt: action.appliedAt?.toISOString() ?? null },
          ];
        }),
      undoable: isUndoable(own, now),
      undoPending: own.some((action) => action.reverse && (action.status === "ready" || action.status === "applying")),
      feedback:
        rated === undefined
          ? null
          : {
              verdict: rated.verdict,
              trueCategory: rated.true_category,
              source: rated.source,
              at: rated.created_at.toISOString(),
            },
      delegation:
        delegation === undefined
          ? null
          : {
              delegateName: delegation.delegate_name,
              status: delegation.status,
              dueAt: delegation.due_at?.toISOString() ?? null,
            },
      suspicious: suspicious.get(row.email_id) ?? [],
      rule: whyOn ? row.rule : null,
      ...(lines === null ? {} : { sender: lines[index] ?? null }),
      ...(openReplies === null ? {} : { reply: { sendId: openReplies.get(row.email_id) ?? null } }),
    };
  });

  const nextBefore =
    found.length > limit ? encodeActivityCursor({ receivedAtKey: last.received_at_key, id: last.email_id }) : null;
  return { items, nextBefore };
}
