import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";
import { APPROVAL_TTL_MS, UNNOTIFIED_TTL_MS } from "../constants";

import { sendFilterExpr, type SendClaimFilter } from "./filters";
import type { DbOrTrx } from "./shared";

type ExpiredReason = "timeout" | "draft_missing" | "not_notified" | "not_seen" | "held_timeout";
// F079: true when an owner received the approval request of the send (one `sent` outbox row of it).
const requestSent = sql<boolean>`exists (
  select 1 from outbox o2
  where o2.org_id = a.org_id and o2.status = 'sent'
    and ((o2.kind = 'approval' and o2.dedup_key = 'approval:' || a.id::text)
      or (o2.kind = 'approval_set' and o2.dedup_key = 'approval_set:' || (a.payload->>'set_id')))
)`;
// D22: the sends of one mailbox that the expiry job closes, each with the first reason that applies.
// `timeout` needs a delivered request. An old request that no owner received ends as `not_seen`, except in a suspended
// organization: there the send waits and the resume hook ends it (F079, `expireUnseenApprovals`).
export async function listExpiredApprovals(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; limit: number; staleBefore: Date }
): Promise<{ id: string; reason: ExpiredReason }[]> {
  const ttlBefore = new Date(opts.now.getTime() - APPROVAL_TTL_MS);
  const createdBefore = new Date(opts.now.getTime() - UNNOTIFIED_TTL_MS);
  const result = await sql<{ id: string; reason: ExpiredReason }>`
    select id, reason from (
      select a.id, a.created_at,
        case
          when a.status = 'awaiting_approval' and a.notified_at < ${ttlBefore} and ${requestSent} then 'timeout'
          when a.status = 'awaiting_approval' and d.status in ('failed', 'undone') then 'draft_missing'
          when a.status = 'awaiting_approval' and a.notified_at is null and a.created_at < ${createdBefore}
            then 'not_notified'
          when a.status = 'awaiting_approval' and a.notified_at < ${ttlBefore} and o.plan <> 'suspended' then 'not_seen'
          when a.status = 'approved' and a.approved_at < ${ttlBefore}
            and (a.locked_at is null or a.locked_at < ${opts.staleBefore}) then 'held_timeout'
        end as reason
      from actions a
      join emails e on e.id = a.email_id and e.org_id = a.org_id
      join organizations o on o.id = a.org_id
      left join actions d on d.id = a.depends_on_action_id and d.org_id = a.org_id
      where a.org_id = ${ctx.orgId} and e.org_id = ${ctx.orgId} and e.mailbox_id = ${mailboxId}
        and a.type = 'send' and a.status in ('awaiting_approval', 'approved')
    ) x
    where reason is not null
    order by created_at, id
    limit ${opts.limit}
  `.execute(db);
  return result.rows;
}
// F079: the `awaiting_approval` sends of an organization whose approval request no owner saw before `before`.
// A request counts as seen when one `outbox` row of it is `sent`. `notified_at` set means the notifier queued it.
// A send with `notified_at` null is not listed: the notifier queues it at its next run, with a fresh text.
// The caller locks each one (`expireSend`).
export async function listUnseenApprovalSends(
  trx: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date }
): Promise<{ id: string; mailboxId: string }[]> {
  const result = await sql<{ id: string; mailbox_id: string }>`
    select a.id, e.mailbox_id
    from actions a
    join emails e on e.id = a.email_id and e.org_id = a.org_id
    where a.org_id = ${ctx.orgId} and e.org_id = ${ctx.orgId}
      and a.type = 'send' and a.status = 'awaiting_approval'
      and a.notified_at is not null and a.notified_at < ${opts.before}
      and not exists (
        select 1 from outbox o
        where o.org_id = a.org_id and o.status = 'sent'
          and ((o.kind = 'approval' and o.dedup_key = 'approval:' || a.id::text)
            or (o.kind = 'approval_set' and o.dedup_key = 'approval_set:' || (a.payload->>'set_id')))
      )
    order by a.created_at, a.id
  `.execute(trx);
  return result.rows.map((row) => ({ id: row.id, mailboxId: row.mailbox_id }));
}
// The `awaiting_approval` sends of one mailbox, oldest first. The caller locks each one (`expireSend`).
export async function listAwaitingSendIds(
  trx: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { emailId?: string } = {}
): Promise<{ id: string; emailId: string }[]> {
  const { emailId } = opts;
  const rows = await trx
    .selectFrom("actions")
    .select(["id", "email_id"])
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("status", "=", "awaiting_approval")
    .where("email_id", "in", (eb) =>
      eb.selectFrom("emails").select("id").where("org_id", "=", ctx.orgId).where("mailbox_id", "=", mailboxId)
    )
    .$if(emailId !== undefined, (qb) => qb.where("email_id", "=", emailId as string))
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({ id: row.id, emailId: row.email_id }));
}
// For /status (D16): the whole organization, or one mailbox. `approvedHeld` is the approved sends that `send` does
// not admit; `approvedSending` is the approved sends that it admits.
export async function countApprovals(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { send: SendClaimFilter; mailboxId?: string }
): Promise<{ waiting: number; oldestNotifiedAt: Date | null; approvedHeld: number; approvedSending: number }> {
  const admitted = sendFilterExpr(opts.send);
  let query = db
    .selectFrom("actions")
    .select([
      sql<string>`count(*) filter (where actions.status = 'awaiting_approval')`.as("waiting"),
      sql<Date | null>`min(actions.notified_at) filter (where actions.status = 'awaiting_approval')`.as("oldest"),
      sql<string>`count(*) filter (where actions.status = 'approved' and not ${admitted})`.as("held"),
      sql<string>`count(*) filter (where actions.status = 'approved' and ${admitted})`.as("sending"),
    ])
    .where("actions.org_id", "=", ctx.orgId)
    .where("actions.type", "=", "send");
  if (opts.mailboxId !== undefined) {
    const mailboxId = opts.mailboxId;
    query = query
      .innerJoin("emails", (join) =>
        join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
      )
      .where("emails.mailbox_id", "=", mailboxId);
  }
  const row = await query.executeTakeFirstOrThrow();
  return {
    waiting: Number(row.waiting),
    oldestNotifiedAt: row.oldest,
    approvedHeld: Number(row.held),
    approvedSending: Number(row.sending),
  };
}
