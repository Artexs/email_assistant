import type { ActionType } from "@ea/core";
import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";
import { emailIdOf } from "../anchor";

import { sendBase, toSendRow, type SendRow } from "./sends";
import { actionTypeSchema, type DbOrTrx } from "./shared";

export interface FailedAction {
  id: string;
  email_id: string;
  type: ActionType;
  reverse: boolean;
  status_reason: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  updated_at: Date;
  subject: string | null;
  mailbox_id: string;
  from_address: string | null;
  message_id_header: string | null;
  folder: string;
  source_folder: string;
}
// No time filter: the notice job marks every row it lists. An original `mail_not_found` row stays quiet;
// a reverse one is listed, because the user tapped Undo and must learn that nothing moved.
export async function listFailedUnnotified(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { limit: number }
): Promise<FailedAction[]> {
  const rows = await db
    .selectFrom("actions")
    .innerJoin("emails", (join) =>
      join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
    )
    .select([
      "actions.id",
      "actions.email_id",
      "actions.loop_id",
      "actions.type",
      "actions.reverses_action_id",
      "actions.status_reason",
      "actions.payload",
      "actions.attempts",
      "actions.updated_at",
      "emails.subject",
      "emails.mailbox_id",
      "emails.from_address",
      "emails.message_id_header",
      "emails.folder",
      "emails.source_folder",
    ])
    .where("actions.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    // loop rows
    .where("actions.email_id", "is not", null)
    .where("actions.status", "=", "failed")
    .where("actions.notified_at", "is", null)
    .where((eb) =>
      eb.or([
        eb("actions.status_reason", "is distinct from", "mail_not_found"),
        eb("actions.reverses_action_id", "is not", null),
      ])
    )
    // One notice per failure: a send and an original draft end in a `send_result` notice.
    .where("actions.type", "<>", "send")
    .where((eb) => eb.or([eb("actions.type", "<>", "create_draft"), eb("actions.reverses_action_id", "is not", null)]))
    .orderBy("actions.updated_at")
    .orderBy("actions.id")
    .limit(opts.limit)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    email_id: emailIdOf(row),
    type: actionTypeSchema.parse(row.type),
    reverse: row.reverses_action_id !== null,
    status_reason: row.status_reason,
    payload: row.payload as Record<string, unknown>,
    attempts: row.attempts,
    updated_at: row.updated_at,
    subject: row.subject,
    mailbox_id: row.mailbox_id,
    from_address: row.from_address,
    message_id_header: row.message_id_header,
    folder: row.folder,
    source_folder: row.source_folder,
  }));
}
export async function markNotified(db: DbOrTrx, ctx: TenantContext, id: string, at: Date): Promise<boolean> {
  const result = await db
    .updateTable("actions")
    .set({ notified_at: at })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("notified_at", "is", null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}
// Sends that wait for an answer and that a card can show: the draft is `applied` and the mailbox is `active`.
function openSends(db: DbOrTrx, ctx: TenantContext) {
  return sendBase(db, ctx)
    .innerJoin("actions as draft", (join) =>
      join.onRef("draft.id", "=", "actions.depends_on_action_id").onRef("draft.org_id", "=", "actions.org_id")
    )
    .innerJoin("mailboxes", (join) =>
      join
        .on(sql<boolean>`mailboxes.id = coalesce(emails.mailbox_id, open_loops.mailbox_id)`)
        .onRef("mailboxes.org_id", "=", "actions.org_id")
    )
    .where("draft.org_id", "=", ctx.orgId)
    .where("mailboxes.org_id", "=", ctx.orgId)
    .where("draft.status", "=", "applied")
    .where("mailboxes.status", "=", "active")
    .where("actions.status", "=", "awaiting_approval");
}
// Sends the notifier can show: also no owner has been told about them yet.
function notifiableSends(db: DbOrTrx, ctx: TenantContext) {
  return openSends(db, ctx).where("actions.notified_at", "is", null);
}
// `skip`: ids that the caller knows it cannot make a card for (a card that the renderer refuses): they must not fill the limit.
export async function listSendsToNotify(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { limit: number; skip?: readonly string[] }
): Promise<SendRow[]> {
  // A follow-up is one card, whatever its payload says about a set.
  // A reply send never gets the generic card: the generic card shows the whole draft text with no consent check of the Telegram link.
  // The `replies_ready` notice and the review cards (`channels/notices/replies-ready.ts`, `channels/reply-review.ts`) are the only way a
  // reply reaches a chat.
  let query = notifiableSends(db, ctx)
    .where(sql<boolean>`(actions.payload->>'set_id' is null or actions.loop_id is not null)`)
    .where(sql<boolean>`actions.payload->>'kind' is distinct from 'reply'`);
  if (opts.skip !== undefined && opts.skip.length > 0) query = query.where("actions.id", "not in", [...opts.skip]);
  const rows = await query.orderBy("actions.created_at").orderBy("actions.id").limit(opts.limit).execute();
  return rows.map(toSendRow);
}
// A set is listed whole, and only when none of its sends waits for a draft.
export async function listSetsToNotify(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { limit: number }
): Promise<Map<string, SendRow[]>> {
  const setIdOf = sql<string>`actions.payload->>'set_id'`;
  // A follow-up never joins a set: the mail-only filter holds even for a payload with a forged `set_id`.
  const candidates = () =>
    notifiableSends(db, ctx)
      .where("actions.email_id", "is not", null)
      .where(sql<boolean>`actions.payload->>'set_id' is not null`).where(sql<boolean>`not exists (
        select 1 from actions s2
        join actions d2 on d2.id = s2.depends_on_action_id and d2.org_id = s2.org_id
        where s2.org_id = actions.org_id and s2.type = 'send'
          and s2.payload->>'set_id' = actions.payload->>'set_id'
          and d2.status in ('ready', 'applying')
      )`);
  const setIds = await candidates()
    .clearSelect()
    .select(setIdOf.as("set_id"))
    .groupBy(setIdOf)
    .orderBy(sql`min(actions.created_at)`)
    .orderBy(setIdOf)
    .limit(opts.limit)
    .execute();
  const grouped = new Map<string, SendRow[]>();
  if (setIds.length === 0) return grouped;
  const rows = await candidates()
    .where(
      setIdOf,
      "in",
      setIds.map((r) => r.set_id)
    )
    .orderBy("actions.created_at")
    .orderBy("actions.id")
    .execute();
  for (const { set_id } of setIds) grouped.set(set_id, []);
  for (const row of rows) {
    const setId = (row.payload as Record<string, unknown>).set_id as string;
    grouped.get(setId)?.push(toSendRow(row));
  }
  return grouped;
}
// An `applied` send waits for its Sent copy outcome; a copy still `pending` after `pendingCopyMaxAgeMs` counts as lost.
export async function listSendResultsToNotify(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { limit: number; now: Date; pendingCopyMaxAgeMs: number }
): Promise<SendRow[]> {
  const pendingBefore = new Date(opts.now.getTime() - opts.pendingCopyMaxAgeMs);
  const rows = await sendBase(db, ctx)
    .where("actions.result_notified_at", "is", null)
    .where((eb) =>
      eb.or([
        // A failed follow-up is told by the fixed `action_failed` notice (`listFailedFollowUps`), not by a result line.
        eb("actions.status", "in", ["expired", "rejected"]),
        eb.and([eb("actions.status", "=", "failed"), eb("actions.loop_id", "is", null)]),
        eb.and([
          eb("actions.status", "=", "applied"),
          eb.or([
            eb(sql<string | null>`actions.provider_result->>'sent_copy'`, "is distinct from", "pending"),
            eb("actions.applied_at", "<", pendingBefore),
          ]),
        ]),
      ])
    )
    .orderBy("actions.updated_at")
    .orderBy("actions.id")
    .limit(opts.limit)
    .execute();
  return rows.map(toSendRow);
}
// The failed sends of follow-ups that no notice told yet. One `action_failed` notice each, with a fixed text.
// `outcome_unknown` is told apart: the mail may have gone out. The notice mark is `result_notified_at`, as for a result.
export interface FailedFollowUp {
  id: string;
  loopId: string;
  unknown: boolean;
  // When the send failed: the time of the event for the push fan-out.
  updatedAt: Date;
}
export async function listFailedFollowUps(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { limit: number }
): Promise<FailedFollowUp[]> {
  const rows = await db
    .selectFrom("actions")
    .select(["id", "loop_id", "status_reason", "updated_at"])
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("status", "=", "failed")
    .where("loop_id", "is not", null)
    .where("result_notified_at", "is", null)
    .orderBy("updated_at")
    .orderBy("id")
    .limit(opts.limit)
    .execute();
  return rows.flatMap((row) =>
    row.loop_id === null
      ? []
      : [
          {
            id: row.id,
            loopId: row.loop_id,
            unknown: row.status_reason === "outcome_unknown",
            updatedAt: row.updated_at,
          },
        ]
  );
}
export async function markResultNotified(db: DbOrTrx, ctx: TenantContext, id: string, at: Date): Promise<boolean> {
  const result = await db
    .updateTable("actions")
    .set({ result_notified_at: at })
    .where("id", "=", id)
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("result_notified_at", "is", null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

export interface SendLimitHold {
  mailboxId: string;
  waiting: number;
  nextAt: Date;
  lastError: string;
}

// One row per mailbox that has sends held by a send limit now. A hold ended when
// `next_attempt_at <= now`: the committer has not run yet, so the send no longer waits on the limit.
// `lastError` is the one of the row that goes out first (ties: smallest id); it names the limit.
export async function listSendLimitHolds(db: DbOrTrx, ctx: TenantContext, now: Date): Promise<SendLimitHold[]> {
  const result = await sql<{ mailbox_id: string; waiting: number; next_at: Date; last_error: string }>`
    select distinct on (a.mailbox_id) a.mailbox_id,
      (count(*) over (partition by a.mailbox_id))::int as waiting,
      min(a.next_attempt_at) over (partition by a.mailbox_id) as next_at,
      a.last_error
    from (
      select e.mailbox_id, actions.id, actions.next_attempt_at, actions.last_error
      from actions
      join emails e on e.id = actions.email_id and e.org_id = actions.org_id
      where actions.org_id = ${ctx.orgId} and e.org_id = ${ctx.orgId}
        and actions.email_id is not null
        and actions.type = 'send' and actions.status = 'approved'
        and actions.last_error like 'send_limit:%'
        and actions.next_attempt_at > ${now}
    ) a
    order by a.mailbox_id, a.next_attempt_at, a.id
  `.execute(db);
  return result.rows.map((row) => ({
    mailboxId: row.mailbox_id,
    waiting: row.waiting,
    nextAt: row.next_at,
    lastError: row.last_error,
  }));
}

// The same hold for the follow-ups of a mailbox: approved follow-up sends that a send limit holds. A separate list because the notice
// for them is a fixed line with the panel link; the mail sends keep their notice.
export async function listFollowUpLimitHolds(db: DbOrTrx, ctx: TenantContext, now: Date): Promise<SendLimitHold[]> {
  const result = await sql<{ mailbox_id: string; waiting: number; next_at: Date; last_error: string }>`
    select distinct on (a.mailbox_id) a.mailbox_id,
      (count(*) over (partition by a.mailbox_id))::int as waiting,
      min(a.next_attempt_at) over (partition by a.mailbox_id) as next_at,
      a.last_error
    from (
      select l.mailbox_id, actions.id, actions.next_attempt_at, actions.last_error
      from actions
      join open_loops l on l.id = actions.loop_id and l.org_id = actions.org_id
      where actions.org_id = ${ctx.orgId} and l.org_id = ${ctx.orgId}
        and actions.type = 'send' and actions.status = 'approved'
        and actions.last_error like 'send_limit:%'
        and actions.next_attempt_at > ${now}
    ) a
    order by a.mailbox_id, a.next_attempt_at, a.id
  `.execute(db);
  return result.rows.map((row) => ({
    mailboxId: row.mailbox_id,
    waiting: row.waiting,
    nextAt: row.next_at,
    lastError: row.last_error,
  }));
}

// The open reply sends of an organization: payload kind `reply`, awaiting approval, draft applied, mailbox active. Oldest
// first (`created_at`, then id). `after`: only the sends that come after this one in that order (a keyset; the review asks for the next).
// `unnotifiedOnly`: only the sends that no `replies_ready` notice counted yet (`notified_at` null).
export async function listOpenReplySends(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { limit: number; after?: { createdAt: Date; id: string }; unnotifiedOnly?: boolean }
): Promise<SendRow[]> {
  let query = openSends(db, ctx).where(sql<boolean>`actions.payload->>'kind' = 'reply'`);
  if (opts.unnotifiedOnly === true) query = query.where("actions.notified_at", "is", null);
  if (opts.after !== undefined) {
    query = query.where(
      sql<boolean>`(actions.created_at, actions.id) > (${opts.after.createdAt}, ${opts.after.id}::uuid)`
    );
  }
  const rows = await query.orderBy("actions.created_at").orderBy("actions.id").limit(opts.limit).execute();
  return rows.map(toSendRow);
}
