import {
  categorySchema,
  readSenderRule,
  toEndpointKind,
  type Category,
  type LlmEndpointKind,
  type SenderRuleKind,
} from "@ea/core";
import { sql, type NotNull } from "kysely";

import type { TenantContext } from "../../../platform/db";
import { mailKindFilter, type MailKind, type TestMailRule } from "../../mail";

import type { DbOrTrx } from "./shared";

export interface TriagedItemRow {
  email_id: string;
  mailbox_id: string;
  category: Category;
  confidence: number;
  reason_code: string;
  reason: string | null;
  model_category: Category | null;
  // The sender rule that shaped the result (`fields.rule`, F110 stage 16); null on an old row.
  rule: SenderRuleKind | null;
  triaged_at: Date;
  received_at: Date;
  from_address: string | null;
  subject: string | null;
  message_id_header: string | null;
  folder: string;
  source_folder: string;
}
export interface UsageRow {
  model: string;
  /** Where the call ran, from the `llm.call` row of the same mail. `standard` when no row says otherwise. */
  endpoint: LlmEndpointKind;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  created_at: Date;
}
// Rows with a model (LLM results) created at or after `since`, oldest first.
export async function listUsageSince(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date,
  opts: { mail: MailKind; testMail: TestMailRule }
): Promise<UsageRow[]> {
  const rows = await db
    .selectFrom("triage_results")
    .innerJoin("emails", (join) =>
      join.onRef("emails.id", "=", "triage_results.email_id").onRef("emails.org_id", "=", "triage_results.org_id")
    )
    .select([
      "triage_results.model",
      "triage_results.tokens_in",
      "triage_results.tokens_out",
      "triage_results.latency_ms",
      "triage_results.created_at",
      // `triage_results` has no endpoint column: the nearest `ok` `llm.call` row of the same mail names it.
      sql<string | null>`(
        SELECT a.data->>'endpoint' FROM audit_log a
        WHERE a.org_id = triage_results.org_id AND a.email_id = triage_results.email_id
          AND a.event = 'llm.call' AND a.reason_code = 'ok'
        ORDER BY abs(extract(epoch FROM a.created_at - triage_results.created_at)), a.id DESC
        LIMIT 1
      )`.as("endpoint_key"),
    ])
    .where("triage_results.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    .where("emails.mailbox_id", "=", mailboxId)
    .where("triage_results.model", "is not", null)
    .where("triage_results.created_at", ">=", since)
    .where(mailKindFilter(opts.mail, opts.testMail))
    .orderBy("triage_results.created_at")
    .orderBy("triage_results.id")
    .$narrowType<{ model: NotNull }>()
    .execute();
  return rows.map(({ endpoint_key, ...row }) => ({ ...row, endpoint: toEndpointKind(endpoint_key) }));
}
// The latest result per email, created in the window `after < created_at <= until` (index triage_results_org_created_idx).
function latestInWindow(orgId: string, range: { after: Date; until: Date }) {
  return sql`
    SELECT DISTINCT ON (tr.email_id) tr.email_id, tr.category, tr.confidence, tr.reason_code, tr.reason, tr.fields, tr.created_at
    FROM triage_results tr
    WHERE tr.org_id = ${orgId} AND tr.created_at > ${range.after} AND tr.created_at <= ${range.until}
    ORDER BY tr.email_id, tr.created_at DESC, tr.id DESC
  `;
}
function readModelCategory(value: string | null): Category | null {
  const parsed = categorySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
// Most urgent category first, then the newest mail.
export async function listTriagedBetween(
  db: DbOrTrx,
  ctx: TenantContext,
  range: { after: Date; until: Date },
  opts: { limit: number; categories?: readonly Category[] }
): Promise<TriagedItemRow[]> {
  const categoryFilter =
    opts.categories === undefined
      ? sql``
      : opts.categories.length === 0
        ? sql`WHERE false`
        : sql`WHERE latest.category IN (${sql.join(opts.categories)})`;
  const { rows } = await sql<{
    email_id: string;
    mailbox_id: string;
    category: string;
    confidence: number;
    reason_code: string;
    reason: string | null;
    model_category: string | null;
    rule: string | null;
    created_at: Date;
    received_at: Date;
    from_address: string | null;
    subject: string | null;
    message_id_header: string | null;
    folder: string;
    source_folder: string;
  }>`
    WITH latest AS (${latestInWindow(ctx.orgId, range)})
    SELECT latest.email_id, latest.category, latest.confidence, latest.reason_code, latest.reason,
           latest.fields->>'model_category' AS model_category, latest.fields->>'rule' AS rule, latest.created_at,
           e.mailbox_id, e.received_at, e.from_address, e.subject, e.message_id_header,
           e.folder, e.source_folder
    FROM latest JOIN emails e ON e.id = latest.email_id AND e.org_id = ${ctx.orgId}
    ${categoryFilter}
    ORDER BY CASE latest.category WHEN 'urgent' THEN 1 WHEN 'needs_reply' THEN 2 WHEN 'delegation' THEN 3
               WHEN 'unsure' THEN 4 WHEN 'info' THEN 5 WHEN 'notification' THEN 6 ELSE 7 END,
             e.received_at DESC, latest.email_id
    LIMIT ${opts.limit}
  `.execute(db);
  return rows.map(({ created_at, ...row }) => ({
    ...row,
    category: categorySchema.parse(row.category),
    model_category: readModelCategory(row.model_category),
    rule: readSenderRule(row.rule),
    triaged_at: created_at,
  }));
}
export async function countTriagedBetween(
  db: DbOrTrx,
  ctx: TenantContext,
  range: { after: Date; until: Date }
): Promise<Partial<Record<Category, number>>> {
  const { rows } = await sql<{ category: string; count: string }>`
    WITH latest AS (${latestInWindow(ctx.orgId, range)})
    SELECT latest.category, count(*) AS count
    FROM latest JOIN emails e ON e.id = latest.email_id AND e.org_id = ${ctx.orgId}
    GROUP BY latest.category
  `.execute(db);
  const counts: Partial<Record<Category, number>> = {};
  for (const row of rows) {
    counts[categorySchema.parse(row.category)] = Number(row.count);
  }
  return counts;
}
export interface ActivityRowsQuery {
  mailboxId?: string;
  categories?: readonly Category[];
  notRated: boolean;
  since: Date;
  cursor?: { receivedAtKey: string; id: string };
  limit: number;
}
export interface ActivityRow {
  email_id: string;
  mailbox_id: string;
  received_at: Date;
  received_at_key: string; // "2026-11-11T09:00:00.123456Z", UTC, microseconds
  triaged_at: Date; // created_at of the latest triage result
  from_address: string | null;
  subject: string | null;
  folder: string;
  category: Category;
  confidence: number;
  reason_code: string;
  reason: string | null;
  model_category: Category | null;
  rule: SenderRuleKind | null;
}
// The activity page: the latest result of each mail received since `since`, newest mail first.
// Keyset order (received_at, id) with a cursor; the key keeps the microseconds of the column.
export async function listActivityRows(db: DbOrTrx, ctx: TenantContext, q: ActivityRowsQuery): Promise<ActivityRow[]> {
  const orgId = ctx.orgId;
  const mailboxFilter = q.mailboxId === undefined ? sql`` : sql`AND e.mailbox_id = ${q.mailboxId}`;
  const categoryFilter =
    q.categories === undefined
      ? sql``
      : q.categories.length === 0
        ? sql`AND false`
        : sql`AND latest.category IN (${sql.join(q.categories)})`;
  const notRatedFilter = q.notRated
    ? sql`AND NOT EXISTS (SELECT 1 FROM triage_feedback f WHERE f.org_id = ${orgId} AND f.email_id = e.id)`
    : sql``;
  const cursorFilter = q.cursor
    ? sql`AND (e.received_at, e.id) < (${q.cursor.receivedAtKey}::timestamptz, ${q.cursor.id}::uuid)`
    : sql``;
  const { rows } = await sql<{
    email_id: string;
    mailbox_id: string;
    received_at: Date;
    received_at_key: string;
    created_at: Date;
    from_address: string | null;
    subject: string | null;
    folder: string;
    category: string;
    confidence: number;
    reason_code: string;
    reason: string | null;
    model_category: string | null;
    rule: string | null;
  }>`
    WITH latest AS (
      SELECT DISTINCT ON (tr.email_id) tr.email_id, tr.category, tr.confidence, tr.reason_code, tr.reason,
             tr.fields->>'model_category' AS model_category, tr.fields->>'rule' AS rule, tr.created_at
      FROM triage_results tr
      JOIN emails e ON e.id = tr.email_id AND e.org_id = ${orgId}
      WHERE tr.org_id = ${orgId} AND e.received_at >= ${q.since} ${mailboxFilter}
      ORDER BY tr.email_id, tr.created_at DESC, tr.id DESC
    )
    SELECT latest.email_id, latest.category, latest.confidence, latest.reason_code, latest.reason,
           latest.model_category, latest.rule, latest.created_at,
           e.mailbox_id, e.received_at,
           to_char(e.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_at_key,
           e.from_address, e.subject, e.folder
    FROM latest JOIN emails e ON e.id = latest.email_id AND e.org_id = ${orgId}
    WHERE true ${categoryFilter} ${notRatedFilter} ${cursorFilter}
    ORDER BY e.received_at DESC, e.id DESC
    LIMIT ${q.limit}
  `.execute(db);
  return rows.map(({ created_at, ...row }) => ({
    ...row,
    category: categorySchema.parse(row.category),
    model_category: readModelCategory(row.model_category),
    rule: readSenderRule(row.rule),
    triaged_at: created_at,
  }));
}
