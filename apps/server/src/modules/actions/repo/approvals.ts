import { sql } from "kysely";

import { dedupKeyOrPush, type TenantContext } from "../../../platform/db";
import { APPROVAL_TTL_MS, REPLY_TTL_MS, UNNOTIFIED_TTL_MS } from "../constants";

import { sendFilterExpr, type SendClaimFilter } from "./filters";
import type { DbOrTrx } from "./shared";

type ExpiredReason = "timeout" | "draft_missing" | "not_notified" | "not_seen" | "held_timeout";
// The outbox rows of the approval request of the send `a`: the Telegram row (`approval:<send id>`, `approval_set:<set id>`) and the
// push rows of the same event (`<key>:push:<device id>`). A sent push row reached an owner as a sent Telegram card did.
const requestRowOf = (row: string) => sql<boolean>`(
  (${sql.raw(row)}.kind = 'approval' and ${dedupKeyOrPush(sql.raw<string>(`${row}.dedup_key`), sql`'approval:' || a.id::text`)})
  or (${sql.raw(row)}.kind = 'approval_set'
    and ${dedupKeyOrPush(sql.raw<string>(`${row}.dedup_key`), sql`'approval_set:' || (a.payload->>'set_id')`)})
)`;
// True when an owner received the approval request of the send (one `sent` outbox row of it, by Telegram or by push).
const requestSent = sql<boolean>`exists (
  select 1 from outbox o2
  where o2.org_id = a.org_id and o2.status = 'sent' and ${requestRowOf("o2")}
)`;
// A reply send (payload kind `reply`). The reply rules differ: a 7-day limit from `created_at`, no `not_notified`, no `not_seen`
// (`approvalExpiresAt` in lifetime.ts holds the same rule for the tap and the panel).
const isReply = sql<boolean>`(a.payload->>'kind' is not distinct from 'reply')`;
// The sends of one mailbox that the expiry job closes, each with the first reason that applies.
// `timeout` needs a delivered request. An old request that no owner received ends as `not_seen`, except in a suspended
// organization: there the send waits and the resume hook ends it (`expireUnseenApprovals`).
// A reply ends as `timeout` 7 days after `created_at`, whatever `notified_at`; the 48 h rules of the other kinds skip it. `not_notified`
// needs no guard: it has the same 7-day cut-off, and the reply clause above it matches first.
export async function listExpiredApprovals(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; limit: number; staleBefore: Date }
): Promise<{ id: string; reason: ExpiredReason }[]> {
  const ttlBefore = new Date(opts.now.getTime() - APPROVAL_TTL_MS);
  const createdBefore = new Date(opts.now.getTime() - UNNOTIFIED_TTL_MS);
  const replyBefore = new Date(opts.now.getTime() - REPLY_TTL_MS);
  const result = await sql<{ id: string; reason: ExpiredReason }>`
    select id, reason from (
      select a.id, a.created_at,
        case
          when a.status = 'awaiting_approval' and ${isReply} and a.created_at < ${replyBefore} then 'timeout'
          when a.status = 'awaiting_approval' and not ${isReply} and a.notified_at < ${ttlBefore} and ${requestSent}
            then 'timeout'
          when a.status = 'awaiting_approval' and d.status in ('failed', 'undone') then 'draft_missing'
          when a.status = 'awaiting_approval' and a.notified_at is null and a.created_at < ${createdBefore}
            then 'not_notified'
          when a.status = 'awaiting_approval' and not ${isReply} and a.notified_at < ${ttlBefore}
            and o.plan <> 'suspended' then 'not_seen'
          when a.status = 'approved' and a.approved_at < ${ttlBefore}
            and (a.locked_at is null or a.locked_at < ${opts.staleBefore}) then 'held_timeout'
        end as reason
      from actions a
      left join emails e on e.id = a.email_id and e.org_id = a.org_id
      left join open_loops l on l.id = a.loop_id and l.org_id = a.org_id
      join organizations o on o.id = a.org_id
      left join actions d on d.id = a.depends_on_action_id and d.org_id = a.org_id
      -- A send of a mail belongs to the mailbox of that mail, a follow-up to the mailbox of its loop.
      where a.org_id = ${ctx.orgId} and coalesce(e.mailbox_id, l.mailbox_id) = ${mailboxId}
        and a.type = 'send' and a.status in ('awaiting_approval', 'approved')
    ) x
    where reason is not null
    order by created_at, id
    limit ${opts.limit}
  `.execute(db);
  return result.rows;
}
// The `awaiting_approval` sends of an organization whose approval request no owner saw before `before`.
// A request counts as seen when one `outbox` row of it is `sent` (a Telegram card or a push row). `notified_at` set means the notifier queued it.
// A send with `notified_at` null is not listed: the notifier queues it at its next run, with a fresh text.
// The caller locks each one (`expireSend`).
export async function listUnseenApprovalSends(
  trx: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date }
): Promise<{ id: string; mailboxId: string }[]> {
  const result = await sql<{ id: string; mailbox_id: string }>`
    select a.id, coalesce(e.mailbox_id, l.mailbox_id) as mailbox_id
    from actions a
    left join emails e on e.id = a.email_id and e.org_id = a.org_id
    left join open_loops l on l.id = a.loop_id and l.org_id = a.org_id
    where a.org_id = ${ctx.orgId}
      and coalesce(e.mailbox_id, l.mailbox_id) is not null
      and a.type = 'send' and a.status = 'awaiting_approval'
      -- A reply never ends as not_seen: it has its own 7-day limit, and the approval detector writes no card for it.
      and a.payload->>'kind' is distinct from 'reply'
      and a.notified_at is not null and a.notified_at < ${opts.before}
      and not exists (
        select 1 from outbox o
        where o.org_id = a.org_id and o.status = 'sent' and ${requestRowOf("o")}
      )
    order by a.created_at, a.id
  `.execute(trx);
  return result.rows.map((row) => ({ id: row.id, mailboxId: row.mailbox_id }));
}
// The `awaiting_approval` sends of one mailbox, oldest first: sends of its mail and follow-ups of its loops. The caller locks each
// one (`expireSend`). `emailId` narrows the list to the sends of one mail (a follow-up has none, so it never matches).
// `kinds`: `replies` lists only the reply sends (payload kind `reply`), `others` every other kind; absent: all.
export async function listAwaitingSendIds(
  trx: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { emailId?: string; kinds?: "replies" | "others" } = {}
): Promise<{ id: string; emailId: string | null }[]> {
  const { emailId, kinds } = opts;
  const rows = await trx
    .selectFrom("actions")
    .select(["id", "email_id", "loop_id"])
    .where("org_id", "=", ctx.orgId)
    .where("type", "=", "send")
    .where("status", "=", "awaiting_approval")
    .where((eb) =>
      eb.or([
        eb(
          "email_id",
          "in",
          eb.selectFrom("emails").select("id").where("org_id", "=", ctx.orgId).where("mailbox_id", "=", mailboxId)
        ),
        eb(
          "loop_id",
          "in",
          eb.selectFrom("open_loops").select("id").where("org_id", "=", ctx.orgId).where("mailbox_id", "=", mailboxId)
        ),
      ])
    )
    .$if(emailId !== undefined, (qb) => qb.where("email_id", "=", emailId as string))
    .$if(kinds === "replies", (qb) => qb.where(sql<boolean>`payload->>'kind' is not distinct from 'reply'`))
    .$if(kinds === "others", (qb) => qb.where(sql<boolean>`payload->>'kind' is distinct from 'reply'`))
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({ id: row.id, emailId: row.email_id }));
}
// For /status: the whole organization, or one mailbox. `approvedHeld` is the approved sends that `send` does
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
      .leftJoin("emails", (join) =>
        join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
      )
      .leftJoin("open_loops", (join) =>
        join.onRef("open_loops.id", "=", "actions.loop_id").onRef("open_loops.org_id", "=", "actions.org_id")
      )
      .where(sql<boolean>`coalesce(emails.mailbox_id, open_loops.mailbox_id) = ${mailboxId}`);
  }
  const row = await query.executeTakeFirstOrThrow();
  return {
    waiting: Number(row.waiting),
    oldestNotifiedAt: row.oldest,
    approvedHeld: Number(row.held),
    approvedSending: Number(row.sending),
  };
}
