import { MAILBOX_ACTION_TYPES, type ActionType } from "@ea/core";
import { sql, type Expression, type ExpressionBuilder, type SqlBool } from "kysely";

import type { DB, TenantContext } from "../../../platform/db";
import { mailKindFilter } from "../../mail";
import { APPROVAL_TTL_MS } from "../constants";

import { mailboxFilterExpr, sendFilterExpr, sqlTrue, type ClaimFilter, type SendClaimFilter } from "./filters";
import { actionTypeSchema, type DbOrTrx } from "./shared";

export interface ClaimedAction {
  id: string;
  email_id: string;
  type: ActionType;
  status: "ready" | "approved" | "applying";
  payload: Record<string, unknown>;
  attempts: number;
  locked_at: Date;
  created_at: Date;
  reverses_action_id: string | null;
  // The `created_at` of the reversed row (reverse rows only): the locate window of a reverse draft.
  original_created_at: Date | null;
  depends_on_action_id: string | null;
  outgoing_message_id: string | null;
  approved_at: Date | null;
  provider_result: Record<string, unknown> | null;
  email: {
    id: string;
    mailbox_id: string;
    folder: string;
    uid: number;
    inbox_uid: number | null;
    /** emails.source_folder (D6). `inbox_uid` keeps its name: the last known UID in this folder (D3). */
    source_folder: string;
    message_id_header: string | null;
    content_hash: string;
    from_address: string | null;
    to_addresses: string[];
    subject: string | null;
    received_at: Date;
    body_text: string | null;
    in_reply_to: string | null;
    references_header: string | null;
    thread_key: string;
  };
}
// D21: age of the action row and of the mail.
export const CLAIM_MAX_AGE_MS = 24 * 3_600_000;
export const CLAIM_MAX_MAIL_AGE_MS = 7 * 24 * 3_600_000;
// D6: save_summary first, the move last (a move can change the UID); a draft before its send.
const TYPE_RANK: Record<ActionType, number> = {
  save_summary: 0,
  flag: 1,
  mark_read: 2,
  move: 3,
  create_draft: 4,
  send: 5,
};
type ClaimEb = ExpressionBuilder<DB, "actions" | "emails">;
interface ClaimWindow {
  now: Date;
  staleBefore: Date;
  filter: ClaimFilter;
}
// The draft of the send (`depends_on_action_id`) is `applied` (same org).
const draftApplied = sql<SqlBool>`EXISTS (
  SELECT 1 FROM actions d
  WHERE d.id = actions.depends_on_action_id AND d.org_id = actions.org_id AND d.status = 'applied'
)`;
// A send of the draft waits for approval (same org).
const sendWaits = sql<SqlBool>`EXISTS (
  SELECT 1 FROM actions s
  WHERE s.depends_on_action_id = actions.id AND s.org_id = actions.org_id AND s.status = 'awaiting_approval'
)`;
// D17. The lock and retry rules apply to every branch; the branches are the S3 mailbox actions, the drafts and the sends.
function claimableWhere(eb: ClaimEb, ctx: TenantContext, mailboxId: string, opts: ClaimWindow): Expression<SqlBool> {
  const { mailbox, send } = opts.filter;
  const mailboxChanges = eb.and([
    eb("actions.status", "=", "ready"),
    eb("actions.type", "in", [...MAILBOX_ACTION_TYPES, "save_summary"]),
    eb.or([
      eb("actions.type", "=", "save_summary"),
      eb("actions.reverses_action_id", "is not", null),
      eb.and([
        eb("actions.created_at", ">=", new Date(opts.now.getTime() - CLAIM_MAX_AGE_MS)),
        eb("emails.received_at", ">=", new Date(opts.now.getTime() - CLAIM_MAX_MAIL_AGE_MS)),
      ]),
    ]),
    mailbox.kind === "none"
      ? eb("actions.type", "=", "save_summary")
      : mailbox.kind === "synthetic"
        ? eb.or([eb("actions.type", "=", "save_summary"), mailKindFilter("synthetic")])
        : sqlTrue,
  ]);
  // A draft is made only while its send waits; an `applying` one is the recovery (D12) and stays behind the mailbox filter.
  const drafts = eb.and([
    eb("actions.type", "=", "create_draft"),
    mailboxFilterExpr(mailbox),
    eb.or([
      eb.and([eb("actions.status", "=", "ready"), eb("actions.reverses_action_id", "is not", null)]),
      eb.and([eb("actions.status", "=", "ready"), eb("actions.reverses_action_id", "is", null), sendWaits]),
      eb.and([eb("actions.status", "=", "applying"), eb("actions.reverses_action_id", "is", null)]),
    ]),
  ]);
  // The `applying` recovery sends nothing: the send filter does not apply (D16).
  const sends = eb.and([
    eb("actions.type", "=", "send"),
    draftApplied,
    eb.or([
      eb.and([
        eb("actions.status", "=", "approved"),
        eb("actions.approved_at", ">=", new Date(opts.now.getTime() - APPROVAL_TTL_MS)),
        sendFilterExpr(send),
      ]),
      eb("actions.status", "=", "applying"),
    ]),
  ]);
  return eb.and([
    eb("actions.org_id", "=", ctx.orgId),
    eb("emails.org_id", "=", ctx.orgId),
    eb("emails.mailbox_id", "=", mailboxId),
    eb.or([eb("actions.next_attempt_at", "is", null), eb("actions.next_attempt_at", "<=", opts.now)]),
    eb.or([eb("actions.locked_at", "is", null), eb("actions.locked_at", "<", opts.staleBefore)]),
    eb.or([mailboxChanges, drafts, sends]),
  ]);
}
export async function countClaimable(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; staleBefore: Date; filter: ClaimFilter }
): Promise<{ total: number; mailboxChanging: number; sending: number }> {
  const row = await db
    .selectFrom("actions")
    .innerJoin("emails", (join) =>
      join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
    )
    .select([
      sql<string>`count(*)`.as("total"),
      sql<string>`count(*) FILTER (WHERE actions.type IN (${sql.join([...MAILBOX_ACTION_TYPES, "create_draft"])}))`.as(
        "mailbox_changing"
      ),
      sql<string>`count(*) FILTER (WHERE actions.type = 'send')`.as("sending"),
    ])
    .where((eb) => claimableWhere(eb, ctx, mailboxId, opts))
    .executeTakeFirstOrThrow();
  return { total: Number(row.total), mailboxChanging: Number(row.mailbox_changing), sending: Number(row.sending) };
}
// D16: `approved` sends of the mailbox with an applied draft that the send filter does not admit (no lock rule).
export async function countHeldSends(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { send: SendClaimFilter }
): Promise<number> {
  const row = await db
    .selectFrom("actions")
    .innerJoin("emails", (join) =>
      join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
    )
    .select(sql<string>`count(*)`.as("count"))
    .where("actions.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    .where("emails.mailbox_id", "=", mailboxId)
    .where("actions.type", "=", "send")
    .where("actions.status", "=", "approved")
    .where(draftApplied)
    .where((eb) => eb.not(sendFilterExpr(opts.send)))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
// `locked_at` = `now` is the token for markApplying, finishAction and releaseAction (also on an `approved` row).
// The claim does not change `attempts` or the status (D7).
export async function claimActions(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; limit: number; staleBefore: Date; filter: ClaimFilter }
): Promise<ClaimedAction[]> {
  const rows = await db
    .with("picked", (qb) =>
      qb
        .selectFrom("actions")
        .innerJoin("emails", (join) =>
          join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
        )
        .select(["actions.id", "actions.email_id"])
        .where((eb) => claimableWhere(eb, ctx, mailboxId, opts))
        .orderBy("emails.received_at")
        .orderBy("emails.id")
        .orderBy(
          sql`CASE actions.type WHEN 'save_summary' THEN 0 WHEN 'flag' THEN 1 WHEN 'mark_read' THEN 2 WHEN 'move' THEN 3 WHEN 'create_draft' THEN 4 WHEN 'send' THEN 5 END`
        )
        .limit(opts.limit)
        .forUpdate("actions")
        .skipLocked()
    )
    .updateTable("actions")
    .set({ locked_at: opts.now, updated_at: opts.now })
    .from("picked")
    .innerJoin("emails", "emails.id", "picked.email_id")
    .whereRef("actions.id", "=", "picked.id")
    .where("actions.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    .returning([
      "actions.id",
      "actions.email_id",
      "actions.type",
      "actions.status",
      "actions.payload",
      "actions.attempts",
      "actions.created_at",
      "actions.reverses_action_id",
      "actions.depends_on_action_id",
      "actions.outgoing_message_id",
      "actions.approved_at",
      "actions.provider_result",
      sql<Date | null>`(SELECT o.created_at FROM actions o WHERE o.id = actions.reverses_action_id AND o.org_id = actions.org_id)`.as(
        "original_created_at"
      ),
      "emails.mailbox_id",
      "emails.folder",
      "emails.uid",
      "emails.inbox_uid",
      "emails.source_folder",
      "emails.message_id_header",
      "emails.content_hash",
      "emails.from_address",
      "emails.to_addresses",
      "emails.received_at",
      "emails.subject",
      "emails.body_text",
      "emails.in_reply_to",
      "emails.references_header",
      "emails.thread_key",
    ])
    .execute();
  return rows
    .map(
      (row): ClaimedAction => ({
        id: row.id,
        email_id: row.email_id,
        type: actionTypeSchema.parse(row.type),
        status: row.status as ClaimedAction["status"],
        payload: row.payload as Record<string, unknown>,
        attempts: row.attempts,
        locked_at: opts.now,
        created_at: row.created_at,
        reverses_action_id: row.reverses_action_id,
        original_created_at: row.original_created_at,
        depends_on_action_id: row.depends_on_action_id,
        outgoing_message_id: row.outgoing_message_id,
        approved_at: row.approved_at,
        provider_result: row.provider_result as Record<string, unknown> | null,
        email: {
          id: row.email_id,
          mailbox_id: row.mailbox_id,
          folder: row.folder,
          uid: Number(row.uid),
          inbox_uid: row.inbox_uid === null ? null : Number(row.inbox_uid),
          source_folder: row.source_folder,
          message_id_header: row.message_id_header,
          content_hash: row.content_hash,
          from_address: row.from_address,
          to_addresses: row.to_addresses,
          subject: row.subject,
          received_at: row.received_at,
          body_text: row.body_text,
          in_reply_to: row.in_reply_to,
          references_header: row.references_header,
          thread_key: row.thread_key,
        },
      })
    )
    .sort(
      (x, y) =>
        x.email.received_at.getTime() - y.email.received_at.getTime() ||
        (x.email_id < y.email_id ? -1 : x.email_id > y.email_id ? 1 : 0) ||
        TYPE_RANK[x.type] - TYPE_RANK[y.type]
    );
}
