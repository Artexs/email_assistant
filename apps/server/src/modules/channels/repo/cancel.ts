import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import { releaseMarksOfFailedDigests } from "./digest-marks";
import type { DbOrTrx } from "./shared";

// Only `pending` rows: a row in flight finishes.
export async function cancelPendingOutbox(
  db: DbOrTrx,
  ctx: TenantContext,
  filter: {
    kind: "auth_error" | "sync_stale" | "send_held" | "host_blocked" | "sent_missing";
    mailboxId: string;
    exceptDedupKey?: string;
    // Only the rows whose dedup key starts with this text (the follow-up hold notice has its own key family).
    dedupPrefix?: string;
  }
): Promise<number> {
  let query = db
    .updateTable("outbox")
    .set({ status: "failed", error_code: "outdated" })
    .where("org_id", "=", ctx.orgId)
    .where("kind", "=", filter.kind)
    .where("mailbox_id", "=", filter.mailboxId)
    .where("status", "=", "pending");
  if (filter.exceptDedupKey !== undefined) query = query.where("dedup_key", "<>", filter.exceptDedupKey);
  if (filter.dedupPrefix !== undefined) {
    const prefix = filter.dedupPrefix;
    query = query.where(sql<boolean>`starts_with(dedup_key, ${prefix})`);
  }
  const result = await query.executeTakeFirst();
  return Number(result.numUpdatedRows);
}
// The suspend hook: queued messages of the organization never go out. `sending` rows finish.
// Approval requests stay `pending`: the notifier queues them once, so a cancelled request would time out unseen.
// They wait for a resume (the sender does not claim them while suspended). At the resume, the sends whose request no owner
// saw end as `not_seen` and their requests are cancelled (`cancelPendingApprovalRequestsOfClosedSends`).
export async function cancelPendingOutboxOfOrg(db: DbOrTrx, ctx: TenantContext): Promise<number> {
  const failed = await db
    .updateTable("outbox")
    .set({ status: "failed", error_code: "outdated", locked_at: null })
    .where("org_id", "=", ctx.orgId)
    .where("status", "=", "pending")
    .where("kind", "not in", ["approval", "approval_set"])
    .returning(["id", "kind", "view", "created_at"])
    .execute();
  await releaseMarksOfFailedDigests(db, ctx, failed);
  return failed.length;
}
// The resume hook. An approval request whose send no longer waits never goes out: its buttons would answer "expired".
// A `pending` row, and a `sending` row whose claim is stale (`locked_at` before `staleBefore`: a crash left it, and the
// sender would claim it again), become `failed` / `outdated`. A `sending` row with a fresh claim is in flight: it finishes.
// A request of a send that still waits stays.
export async function cancelPendingApprovalRequestsOfClosedSends(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { staleBefore: Date }
): Promise<number> {
  const result = await sql`
    update outbox set status = 'failed', error_code = 'outdated', locked_at = null
    where org_id = ${ctx.orgId} and kind in ('approval', 'approval_set')
      and ${waitingApprovalRequest(opts.staleBefore)}
      and ${noAwaitingApprovalSend}
  `.execute(db);
  return Number(result.numAffectedRows ?? 0);
}
// The outbox row of `outbox` that no sender has taken: `pending`, or `sending` with a stale claim.
function waitingApprovalRequest(staleBefore: Date) {
  return sql`(status = 'pending' or (status = 'sending' and locked_at < ${staleBefore}))`;
}
// The request of an `outbox` row (`approval` or `approval_set`) has no send that still waits for an answer. One predicate
// for the resume hook and for the erase of one person's data.
const noAwaitingApprovalSend = sql`not exists (
  select 1 from actions a
  where a.org_id = outbox.org_id and a.type = 'send' and a.status = 'awaiting_approval'
    and ((outbox.kind = 'approval' and (outbox.dedup_key = 'approval:' || a.id::text or outbox.dedup_key like 'approval:' || a.id::text || ':r%'))
      or (outbox.kind = 'approval_set' and outbox.dedup_key = 'approval_set:' || (a.payload->>'set_id')))
)`;
// The erase of one person's data: a waiting approval-set request whose sends all closed (the sender holds
// it, for quiet hours or lag) still lists the erased subject in its view. It becomes `failed` / `outdated` (as at a resume)
// and loses its text and view. A request of a send that still waits stays: the erase refuses while such a send names the
// mail. Only rows created at or after `since`. Returns the number of rows changed.
export async function closeWaitingApprovalSetsSince(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { since: Date; staleBefore: Date; text: string }
): Promise<number> {
  const result = await sql`
    update outbox set status = 'failed', error_code = 'outdated', locked_at = null, text = ${opts.text}, view = '{}'::jsonb
    where org_id = ${ctx.orgId} and kind = 'approval_set' and created_at >= ${opts.since}
      and ${waitingApprovalRequest(opts.staleBefore)}
      and ${noAwaitingApprovalSend}
  `.execute(db);
  return Number(result.numAffectedRows ?? 0);
}
// Members that got a "sync is late" notice for an episode and no "sync works again" notice yet.
export async function listSentStaleEpisodes(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<{ userId: string; episode: string }[]> {
  const rows = await db
    .selectFrom("outbox as s")
    .select(["s.user_id", sql<string>`split_part(s.dedup_key, ':', 3)`.as("episode")])
    .where("s.org_id", "=", ctx.orgId)
    .where("s.mailbox_id", "=", mailboxId)
    .where("s.kind", "=", "sync_stale")
    .where("s.status", "=", "sent")
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("outbox as ok")
            .select("ok.id")
            .whereRef("ok.org_id", "=", "s.org_id")
            .whereRef("ok.user_id", "=", "s.user_id")
            .where(
              sql<boolean>`ok.dedup_key = 'sync_ok:' || s.mailbox_id::text || ':' || split_part(s.dedup_key, ':', 3)`
            )
        )
      )
    )
    .orderBy("s.created_at")
    .execute();
  return rows.map((row) => ({ userId: row.user_id, episode: row.episode }));
}
