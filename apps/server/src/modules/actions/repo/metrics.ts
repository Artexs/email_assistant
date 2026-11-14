// Row readers of the action metrics (M3). Every table is joined with its own `org_id` filter.
// The rows hold ids, folders, reasons and times only: no subject and no text. `fromAddress` is for the whitelist check.
import { categorySchema, isMoveTarget, rejectReasons } from "@ea/core";
import type { HiddenMoveRow, MistakeRow, RejectRow, WeekQuery } from "@ea/core";
import { sql } from "kysely";
import { z } from "zod";

import type { TenantContext } from "../../../platform/db";
import { mailKindFilter } from "../../mail";

import type { DbOrTrx } from "./shared";

export type HiddenMoveRowWithMail = Omit<HiddenMoveRow, "whitelisted"> & {
  mailboxId: string;
  fromAddress: string | null;
};

// Real mail of the organization, and of one mailbox when the query names it: the `emails` table.
function mailScope(ctx: TenantContext, q: WeekQuery) {
  const mailbox = q.mailboxId === null ? sql`true` : sql`emails.mailbox_id = ${q.mailboxId}`;
  return sql`emails.org_id = ${ctx.orgId} AND ${mailbox} AND ${mailKindFilter("real", q.testMail)}`;
}

const hiddenRowSchema = z.object({
  email_id: z.string(),
  applied_at: z.date(),
  folder: z.string().nullable(),
  mailbox_id: z.string(),
  from_address: z.string().nullable(),
  vip: z.boolean(),
  truth: categorySchema.nullable(),
});

/** M3 (a) input: the original moves of real mail that took effect in the range and left the mail outside the inbox. */
export async function listHiddenMoveRows(
  db: DbOrTrx,
  ctx: TenantContext,
  q: WeekQuery
): Promise<HiddenMoveRowWithMail[]> {
  const { rows } = await sql<unknown>`
    SELECT a.email_id, a.applied_at, a.payload->>'folder' AS folder, emails.mailbox_id, emails.from_address,
      COALESCE(t.vip, false) AS vip, f.true_category AS truth
    FROM actions a
    JOIN emails ON emails.id = a.email_id AND emails.org_id = ${ctx.orgId}
    LEFT JOIN LATERAL (
      SELECT tr.vip
      FROM triage_results tr
      WHERE tr.org_id = ${ctx.orgId} AND tr.email_id = a.email_id
      ORDER BY tr.created_at DESC, tr.id DESC
      LIMIT 1
    ) t ON true
    LEFT JOIN LATERAL (
      SELECT tf.true_category
      FROM triage_feedback tf
      WHERE tf.org_id = ${ctx.orgId} AND tf.email_id = a.email_id
      ORDER BY tf.created_at DESC, tf.id DESC
      LIMIT 1
    ) f ON true
    WHERE a.org_id = ${ctx.orgId} AND a.type = 'move' AND a.reverses_action_id IS NULL
      AND a.status IN ('applied', 'undone')
      AND a.applied_at >= ${q.range.start} AND a.applied_at < ${q.range.end}
      AND ${mailScope(ctx, q)}
    ORDER BY a.applied_at, a.id
  `.execute(db);
  const result: HiddenMoveRowWithMail[] = [];
  for (const raw of rows) {
    const row = hiddenRowSchema.parse(raw);
    if (!isMoveTarget(row.folder) || row.folder === "inbox") continue;
    result.push({
      emailId: row.email_id,
      appliedAt: row.applied_at,
      folder: row.folder,
      truth: row.truth,
      vip: row.vip,
      mailboxId: row.mailbox_id,
      fromAddress: row.from_address,
    });
  }
  return result;
}

const rejectRowSchema = z.object({
  action_id: z.string(),
  rejected_at: z.date(),
  reason: z.enum(rejectReasons).nullable(),
});

/** M3 (b), (c) input: rejected sends of real mail whose first reject audit row is in the range, with their reason. */
export async function listRejectRows(db: DbOrTrx, ctx: TenantContext, q: WeekQuery): Promise<RejectRow[]> {
  const { rows } = await sql<unknown>`
    SELECT a.id AS action_id, r.rejected_at, af.reason
    FROM actions a
    JOIN emails ON emails.id = a.email_id AND emails.org_id = ${ctx.orgId}
    JOIN LATERAL (
      SELECT MIN(al.created_at) AS rejected_at
      FROM audit_log al
      WHERE al.org_id = ${ctx.orgId} AND al.action_id = a.id AND al.event = 'action.rejected'
    ) r ON r.rejected_at >= ${q.range.start} AND r.rejected_at < ${q.range.end}
    LEFT JOIN action_feedback af
      ON af.org_id = ${ctx.orgId} AND af.action_id = a.id AND af.kind = 'reject_reason'
    WHERE a.org_id = ${ctx.orgId} AND a.type = 'send' AND a.status = 'rejected'
      AND ${mailScope(ctx, q)}
    ORDER BY r.rejected_at, a.id
  `.execute(db);
  return rows.map((raw) => {
    const row = rejectRowSchema.parse(raw);
    return { actionId: row.action_id, rejectedAt: row.rejected_at, reason: row.reason };
  });
}

const mistakeRowSchema = z.object({ action_id: z.string(), sent_at: z.date() });

/** M3 (d) input: "this was a mistake" taps on sends of real mail that went out in the range. */
export async function listMistakeRows(db: DbOrTrx, ctx: TenantContext, q: WeekQuery): Promise<MistakeRow[]> {
  const { rows } = await sql<unknown>`
    SELECT a.id AS action_id, a.applied_at AS sent_at
    FROM action_feedback af
    JOIN actions a ON a.id = af.action_id AND a.org_id = ${ctx.orgId}
    JOIN emails ON emails.id = a.email_id AND emails.org_id = ${ctx.orgId}
    WHERE af.org_id = ${ctx.orgId} AND af.kind = 'mistake'
      AND a.type = 'send' AND a.status = 'applied'
      AND a.applied_at >= ${q.range.start} AND a.applied_at < ${q.range.end}
      AND ${mailScope(ctx, q)}
    ORDER BY a.applied_at, a.id
  `.execute(db);
  return rows.map((raw) => {
    const row = mistakeRowSchema.parse(raw);
    return { actionId: row.action_id, sentAt: row.sent_at };
  });
}
