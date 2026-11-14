// Row readers of the mail-level metrics (M1, M4). Every table is joined with its own `org_id` filter.
// The rows hold ids, categories and flags only: no subject and no text.
import { categorySchema, feedbackSources, truthSourceOf } from "@ea/core";
import type { HandledRow, MailTruthRow, WeekQuery } from "@ea/core";
import { sql, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { mailKindFilter } from "../mail";

type DbOrTrx = Db | Transaction<DB>;

// Real mail of the organization received in the range (and of one mailbox) with a triage result: `emails` and `t`.
function mailScope(ctx: TenantContext, q: WeekQuery) {
  const mailbox = q.mailboxId === null ? sql`true` : sql`emails.mailbox_id = ${q.mailboxId}`;
  return {
    latestResult: sql`JOIN LATERAL (
      SELECT tr.category, tr.created_at
      FROM triage_results tr
      WHERE tr.org_id = ${ctx.orgId} AND tr.email_id = emails.id
      ORDER BY tr.created_at DESC, tr.id DESC
      LIMIT 1
    ) t ON true`,
    where: sql`emails.org_id = ${ctx.orgId}
      AND emails.received_at >= ${q.range.start} AND emails.received_at < ${q.range.end}
      AND ${mailbox}
      AND ${mailKindFilter("real", q.testMail)}`,
  };
}

const truthRowSchema = z.object({
  email_id: z.string(),
  predicted: categorySchema,
  true_category: categorySchema.nullable(),
  source: z.enum(feedbackSources).nullable(),
  verdict: z.string().nullable(),
});

/** M1 input: the latest triage result and the latest feedback row of each real mail of the week. */
export async function listTruthRows(db: DbOrTrx, ctx: TenantContext, q: WeekQuery): Promise<MailTruthRow[]> {
  const scope = mailScope(ctx, q);
  const { rows } = await sql<unknown>`
    SELECT emails.id AS email_id, t.category AS predicted, f.true_category, f.source, f.verdict
    FROM emails
    ${scope.latestResult}
    LEFT JOIN LATERAL (
      SELECT tf.true_category, tf.source, tf.verdict
      FROM triage_feedback tf
      WHERE tf.org_id = ${ctx.orgId} AND tf.email_id = emails.id
      ORDER BY tf.created_at DESC, tf.id DESC
      LIMIT 1
    ) f ON true
    WHERE ${scope.where}
    ORDER BY emails.received_at, emails.id
  `.execute(db);
  return rows.map((raw) => {
    const row = truthRowSchema.parse(raw);
    return {
      emailId: row.email_id,
      predicted: row.predicted,
      truth: row.true_category,
      truthSource: row.source === null ? null : truthSourceOf(row.source),
      wrongOnly: row.verdict === "wrong" && row.true_category === null,
    };
  });
}

const handledRowSchema = z.object({
  email_id: z.string(),
  category: categorySchema,
  applied: z.boolean(),
  undone: z.boolean(),
  logged: z.boolean(),
  wrong_within_7_days: z.boolean(),
  delegation_send_applied: z.boolean(),
  delegation_cancelled: z.boolean(),
});

/** M4 input: what the assistant did with each real mail of the week. */
export async function listHandledRows(db: DbOrTrx, ctx: TenantContext, q: WeekQuery): Promise<HandledRow[]> {
  const scope = mailScope(ctx, q);
  // An original mailbox action of the mail in the given status.
  const mailboxAction = (status: string) => sql`EXISTS (
    SELECT 1 FROM actions a
    WHERE a.org_id = ${ctx.orgId} AND a.email_id = emails.id AND a.reverses_action_id IS NULL
      AND a.type IN ('move', 'mark_read', 'flag') AND a.status = ${status}
  )`;
  const { rows } = await sql<unknown>`
    SELECT emails.id AS email_id, t.category,
      ${mailboxAction("applied")} AS applied,
      ${mailboxAction("undone")} AS undone,
      ${mailboxAction("logged")} AS logged,
      EXISTS (
        SELECT 1 FROM triage_feedback tf
        WHERE tf.org_id = ${ctx.orgId} AND tf.email_id = emails.id AND tf.verdict = 'wrong'
          AND tf.created_at <= t.created_at + interval '7 days'
      ) AS wrong_within_7_days,
      EXISTS (
        SELECT 1 FROM actions a
        WHERE a.org_id = ${ctx.orgId} AND a.email_id = emails.id AND a.reverses_action_id IS NULL
          AND a.type = 'send' AND a.status = 'applied' AND a.payload->>'kind' = 'delegation'
      ) AS delegation_send_applied,
      COALESCE((
        SELECT d.status = 'cancelled' FROM delegations d
        WHERE d.org_id = ${ctx.orgId} AND d.email_id = emails.id
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT 1
      ), false) AS delegation_cancelled
    FROM emails
    ${scope.latestResult}
    WHERE ${scope.where}
    ORDER BY emails.received_at, emails.id
  `.execute(db);
  return rows.map((raw) => {
    const row = handledRowSchema.parse(raw);
    return {
      emailId: row.email_id,
      category: row.category,
      mailboxActionApplied: row.applied,
      mailboxActionUndone: row.undone,
      mailboxActionLogged: row.logged,
      wrongWithin7Days: row.wrong_within_7_days,
      delegationSendApplied: row.delegation_send_applied,
      delegationCancelled: row.delegation_cancelled,
    };
  });
}
