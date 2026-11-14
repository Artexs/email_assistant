import type { ActionType } from "@ea/core";
import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

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
// No time filter (M11): the notice job marks every row it lists. An original `mail_not_found` row stays quiet;
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
    .where("actions.status", "=", "failed")
    .where("actions.notified_at", "is", null)
    .where((eb) =>
      eb.or([
        eb("actions.status_reason", "is distinct from", "mail_not_found"),
        eb("actions.reverses_action_id", "is not", null),
      ])
    )
    // One notice per failure (D20): a send and an original draft end in a `send_result` notice.
    .where("actions.type", "<>", "send")
    .where((eb) => eb.or([eb("actions.type", "<>", "create_draft"), eb("actions.reverses_action_id", "is not", null)]))
    .orderBy("actions.updated_at")
    .orderBy("actions.id")
    .limit(opts.limit)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    email_id: row.email_id,
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
// Sends the notifier can show: the draft is `applied` and the mailbox is `active`.
function notifiableSends(db: DbOrTrx, ctx: TenantContext) {
  return sendBase(db, ctx)
    .innerJoin("actions as draft", (join) =>
      join.onRef("draft.id", "=", "actions.depends_on_action_id").onRef("draft.org_id", "=", "actions.org_id")
    )
    .innerJoin("mailboxes", (join) =>
      join.onRef("mailboxes.id", "=", "emails.mailbox_id").onRef("mailboxes.org_id", "=", "actions.org_id")
    )
    .where("draft.org_id", "=", ctx.orgId)
    .where("mailboxes.org_id", "=", ctx.orgId)
    .where("draft.status", "=", "applied")
    .where("mailboxes.status", "=", "active")
    .where("actions.status", "=", "awaiting_approval")
    .where("actions.notified_at", "is", null);
}
export async function listSendsToNotify(db: DbOrTrx, ctx: TenantContext, opts: { limit: number }): Promise<SendRow[]> {
  const rows = await notifiableSends(db, ctx)
    .where(sql<boolean>`actions.payload->>'set_id' is null`)
    .orderBy("actions.created_at")
    .orderBy("actions.id")
    .limit(opts.limit)
    .execute();
  return rows.map(toSendRow);
}
// A set is listed whole, and only when none of its sends waits for a draft (D21).
export async function listSetsToNotify(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { limit: number }
): Promise<Map<string, SendRow[]>> {
  const setIdOf = sql<string>`actions.payload->>'set_id'`;
  const candidates = () =>
    notifiableSends(db, ctx).where(sql<boolean>`actions.payload->>'set_id' is not null`).where(sql<boolean>`not exists (
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
// D20: an `applied` send waits for its Sent copy outcome; a copy still `pending` after `pendingCopyMaxAgeMs` counts as lost.
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
        eb("actions.status", "in", ["failed", "expired", "rejected"]),
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

// One row per mailbox that has sends held by a send limit now (PD-044, F099 D11). A hold ended when
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
