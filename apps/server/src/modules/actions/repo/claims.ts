import { MAILBOX_ACTION_TYPES, type ActionType, DAY_MS } from "@ea/core";
import { sql, type Expression, type ExpressionBuilder, type SelectQueryBuilder, type SqlBool } from "kysely";

import type { DB, TenantContext } from "../../../platform/db";
import { mailKindFilter } from "../../mail";
import { ActionAnchorError, anchorOfRow, emailIdOf } from "../anchor";
import { APPROVAL_TTL_MS } from "../constants";

import { mailboxFilterExpr, sendFilterExpr, sqlTrue, type ClaimFilter, type SendClaimFilter } from "./filters";
import { actionTypeSchema, type DbOrTrx } from "./shared";

export interface ClaimedAction {
  id: string;
  // An action hangs on a mail or on a loop (a follow-up): exactly one of the two is set. `mailbox_id` is the mailbox of
  // the mail, or of the loop (`open_loops.mailbox_id`).
  email_id: string | null;
  loop_id: string | null;
  mailbox_id: string;
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
  // null for a loop action. The mailbox changes and the draft of a mail read it through `mailOf`.
  email: {
    id: string;
    mailbox_id: string;
    folder: string;
    uid: number;
    source_uid: number | null;
    /** emails.source_folder. `source_uid` is the last known UID in this folder. */
    source_folder: string;
    message_id_header: string | null;
    content_hash: string;
    from_address: string | null;
    /** `email_headers.from_name`: the display name of the sender, or null (a reply quotes it). */
    from_name: string | null;
    to_addresses: string[];
    subject: string | null;
    received_at: Date;
    body_text: string | null;
    in_reply_to: string | null;
    references_header: string | null;
    thread_key: string;
  } | null;
}
/** The mail of a claimed action for the code that exists only for incoming mail. A loop action throws `loop_anchor`. */
export function mailOf(action: ClaimedAction): NonNullable<ClaimedAction["email"]> {
  emailIdOf(action);
  if (action.email === null) throw new ActionAnchorError("invalid_anchor");
  return action.email;
}
// Age of the action row and of the mail.
export const CLAIM_MAX_AGE_MS = DAY_MS;
export const CLAIM_MAX_MAIL_AGE_MS = 7 * DAY_MS;
// save_summary first, the move last (a move can change the UID); a draft before its send.
const TYPE_RANK: Record<ActionType, number> = {
  save_summary: 0,
  flag: 1,
  mark_read: 2,
  move: 3,
  create_draft: 4,
  send: 5,
};
type ClaimEb = ExpressionBuilder<DB, "actions" | "emails" | "open_loops">;
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
// The action belongs to the mailbox through its mail, or through its loop (a follow-up). Both joins are on `org_id` too.
function inMailbox(eb: ClaimEb, ctx: TenantContext, mailboxId: string): Expression<SqlBool> {
  return eb.or([
    eb.and([eb("emails.org_id", "=", ctx.orgId), eb("emails.mailbox_id", "=", mailboxId)]),
    eb.and([eb("open_loops.org_id", "=", ctx.orgId), eb("open_loops.mailbox_id", "=", mailboxId)]),
  ]);
}
// The lock and retry rules apply to every branch; the branches are the mailbox actions, the drafts and the sends.
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
        ? eb.or([eb("actions.type", "=", "save_summary"), mailKindFilter("synthetic", mailbox.testMail)])
        : sqlTrue,
  ]);
  // A draft is made only while its send waits; an `applying` one is the recovery and stays behind the mailbox filter.
  const drafts = eb.and([
    eb("actions.type", "=", "create_draft"),
    mailboxFilterExpr(mailbox),
    eb.or([
      eb.and([eb("actions.status", "=", "ready"), eb("actions.reverses_action_id", "is not", null)]),
      eb.and([eb("actions.status", "=", "ready"), eb("actions.reverses_action_id", "is", null), sendWaits]),
      eb.and([eb("actions.status", "=", "applying"), eb("actions.reverses_action_id", "is", null)]),
    ]),
  ]);
  // The `applying` recovery sends nothing: the send filter does not apply.
  const sends = eb.and([
    eb("actions.type", "=", "send"),
    draftApplied,
    eb.or([
      eb.and([
        eb("actions.status", "=", "approved"),
        eb("actions.approved_at", ">=", new Date(opts.now.getTime() - APPROVAL_TTL_MS)),
        sendFilterExpr(send),
        opts.filter.replies === "off" ? sql<SqlBool>`actions.payload->>'kind' is distinct from 'reply'` : sqlTrue,
      ]),
      eb("actions.status", "=", "applying"),
    ]),
  ]);
  return eb.and([
    eb("actions.org_id", "=", ctx.orgId),
    inMailbox(eb, ctx, mailboxId),
    eb.or([eb("actions.next_attempt_at", "is", null), eb("actions.next_attempt_at", "<=", opts.now)]),
    eb.or([eb("actions.locked_at", "is", null), eb("actions.locked_at", "<", opts.staleBefore)]),
    eb.or([mailboxChanges, drafts, sends]),
  ]);
}
// The two anchors of an action, as left joins on `org_id` too. An action has one of them: the other join gives null columns.
function joinAnchors<QB extends SelectQueryBuilder<DB, "actions", object>>(qb: QB) {
  return qb
    .leftJoin("emails", (join) =>
      join.onRef("emails.id", "=", "actions.email_id").onRef("emails.org_id", "=", "actions.org_id")
    )
    .leftJoin("open_loops", (join) =>
      join.onRef("open_loops.id", "=", "actions.loop_id").onRef("open_loops.org_id", "=", "actions.org_id")
    );
}
export async function countClaimable(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; staleBefore: Date; filter: ClaimFilter }
): Promise<{ total: number; mailboxChanging: number; sending: number }> {
  const row = await joinAnchors(db.selectFrom("actions"))
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
// `approved` sends of the mailbox with an applied draft that the send filter does not admit (no lock rule).
export async function countHeldSends(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { send: SendClaimFilter }
): Promise<number> {
  const row = await joinAnchors(db.selectFrom("actions"))
    .select(sql<string>`count(*)`.as("count"))
    .where("actions.org_id", "=", ctx.orgId)
    .where((eb) => inMailbox(eb, ctx, mailboxId))
    .where("actions.type", "=", "send")
    .where("actions.status", "=", "approved")
    .where(draftApplied)
    .where((eb) => eb.not(sendFilterExpr(opts.send)))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
// `locked_at` = `now` is the token for markApplying, finishAction and releaseAction (also on an `approved` row).
// The claim does not change `attempts` or the status.
export async function claimActions(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; limit: number; staleBefore: Date; filter: ClaimFilter }
): Promise<ClaimedAction[]> {
  const rows = await db
    .with("picked", (qb) =>
      joinAnchors(qb.selectFrom("actions"))
        .select(["actions.id", "actions.email_id", "actions.loop_id"])
        .where((eb) => claimableWhere(eb, ctx, mailboxId, opts))
        // A follow-up has no mail: the age of its action orders it.
        .orderBy(sql`coalesce(emails.received_at, actions.created_at)`)
        .orderBy(sql`coalesce(emails.id, actions.loop_id)`)
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
    .leftJoin("emails", (join) => join.onRef("emails.id", "=", "picked.email_id").on("emails.org_id", "=", ctx.orgId))
    .leftJoin("open_loops", (join) =>
      join.onRef("open_loops.id", "=", "picked.loop_id").on("open_loops.org_id", "=", ctx.orgId)
    )
    .whereRef("actions.id", "=", "picked.id")
    .where("actions.org_id", "=", ctx.orgId)
    .returning([
      "actions.id",
      "actions.email_id",
      "actions.loop_id",
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
      sql<string>`coalesce(emails.mailbox_id, open_loops.mailbox_id)`.as("mailbox_id"),
      // The display name of the sender (a reply quotes it); null when the mail has no header row or no name.
      sql<
        string | null
      >`(SELECT h.from_name FROM email_headers h WHERE h.email_id = emails.id AND h.org_id = emails.org_id)`.as(
        "from_name"
      ),
      "emails.id as mail_id",
      "emails.folder",
      "emails.uid",
      "emails.source_uid",
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
  const claimed = rows.map((row): ClaimedAction => {
    const anchor = anchorOfRow(row);
    return {
      id: row.id,
      email_id: anchor.kind === "email" ? anchor.emailId : null,
      loop_id: anchor.kind === "loop" ? anchor.loopId : null,
      mailbox_id: row.mailbox_id,
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
      email:
        anchor.kind === "loop" || row.mail_id === null
          ? null
          : {
              id: anchor.emailId,
              mailbox_id: row.mailbox_id,
              folder: row.folder as string,
              uid: Number(row.uid),
              source_uid: row.source_uid === null ? null : Number(row.source_uid),
              source_folder: row.source_folder as string,
              message_id_header: row.message_id_header,
              content_hash: row.content_hash as string,
              from_address: row.from_address,
              from_name: row.from_name,
              to_addresses: row.to_addresses as string[],
              subject: row.subject,
              received_at: row.received_at as Date,
              body_text: row.body_text,
              in_reply_to: row.in_reply_to,
              references_header: row.references_header,
              thread_key: row.thread_key as string,
            },
    };
  });
  // The same order as the pick: the age of the mail, or of the action of a follow-up; then the anchor id; then the type.
  const ageOf = (row: ClaimedAction): number => (row.email?.received_at ?? row.created_at).getTime();
  const anchorKeyOf = (row: ClaimedAction): string => row.email_id ?? row.loop_id ?? "";
  return claimed.sort(
    (x, y) =>
      ageOf(x) - ageOf(y) ||
      (anchorKeyOf(x) < anchorKeyOf(y) ? -1 : anchorKeyOf(x) > anchorKeyOf(y) ? 1 : 0) ||
      TYPE_RANK[x.type] - TYPE_RANK[y.type]
  );
}
