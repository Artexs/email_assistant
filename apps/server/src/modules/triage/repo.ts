import {
  categorySchema,
  feedbackSources,
  feedbackVerdicts,
  type Category,
  type FeedbackSource,
  type FeedbackVerdict,
} from "@ea/core";
import { sql, type NotNull, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";
import { mailKindFilter, type MailKind } from "../mail";

type DbOrTrx = Db | Transaction<DB>;

export type { MailKind };

export interface TriageResultInput {
  emailId: string;
  category: Category;
  vip: boolean;
  confidence: number;
  reasonCode: string;
  reason: string | null;
  fields: Record<string, unknown>;
  model: string | null;
  promptVersion: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number | null;
}

export interface LatestTriageResult {
  id: string;
  category: Category;
  confidence: number;
  reason_code: string;
  model: string | null;
  fields: unknown;
}

export interface UnlabeledResult {
  email_id: string;
  received_at: Date;
  from_address: string | null;
  subject: string | null;
  category: Category;
  confidence: number;
  reason_code: string;
  fields: unknown;
}

export interface LabeledResult {
  email_id: string;
  category: Category;
  confidence: number;
  reason_code: string;
  model: string | null;
  fields: unknown;
  verdict: FeedbackVerdict;
  true_category: Category | null;
}

export interface TriagedItemRow {
  email_id: string;
  mailbox_id: string;
  category: Category;
  confidence: number;
  reason_code: string;
  reason: string | null;
  model_category: Category | null;
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
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  created_at: Date;
}

export interface FeedbackInput {
  emailId: string;
  verdict: FeedbackVerdict;
  trueCategory: Category | null;
  source: FeedbackSource;
  userId: string | null;
}

// The foreign key (email_id, org_id) rejects an email of another org.
export async function insertTriageResult(db: DbOrTrx, ctx: TenantContext, row: TriageResultInput): Promise<string> {
  const inserted = await db
    .insertInto("triage_results")
    .values({
      org_id: ctx.orgId,
      email_id: row.emailId,
      category: row.category,
      vip: row.vip,
      confidence: row.confidence,
      reason_code: row.reasonCode,
      reason: row.reason,
      fields: JSON.stringify(row.fields),
      model: row.model,
      prompt_version: row.promptVersion,
      tokens_in: row.tokensIn,
      tokens_out: row.tokensOut,
      latency_ms: row.latencyMs,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

// Newest first; on a `created_at` tie `id` gives a stable order, the same as `listLabeledResults`.
export async function latestTriageResult(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string
): Promise<LatestTriageResult | undefined> {
  const row = await db
    .selectFrom("triage_results")
    .select(["id", "category", "confidence", "reason_code", "model", "fields"])
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!row) {
    return undefined;
  }
  return { ...row, category: categorySchema.parse(row.category) };
}

// The latest result per email (created_at desc, id desc, as `listLabeledResults`), in chunks of 500 ids.
export async function listLatestTriageByEmailIds(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<
  {
    email_id: string;
    category: Category;
    confidence: number;
    reason_code: string;
    model: string | null;
    prompt_version: string | null;
    fields: unknown;
  }[]
> {
  const out = [];
  for (let i = 0; i < emailIds.length; i += 500) {
    const rows = await db
      .selectFrom("triage_results")
      .distinctOn("email_id")
      .select(["email_id", "category", "confidence", "reason_code", "model", "prompt_version", "fields"])
      .where("org_id", "=", ctx.orgId)
      .where("email_id", "in", emailIds.slice(i, i + 500))
      .orderBy("email_id")
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute();
    out.push(...rows.map((row) => ({ ...row, category: categorySchema.parse(row.category) })));
  }
  return out;
}

export async function insertFeedback(db: DbOrTrx, ctx: TenantContext, row: FeedbackInput): Promise<string> {
  const inserted = await db
    .insertInto("triage_feedback")
    .values({
      org_id: ctx.orgId,
      email_id: row.emailId,
      verdict: row.verdict,
      true_category: row.trueCategory,
      source: row.source,
      user_id: row.userId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

const verdictSchema = z.enum(feedbackVerdicts);

// Newest first; on a `created_at` tie `id` gives a stable order, the same as `listLabeledResults`.
export async function latestFeedback(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string
): Promise<{ id: string; verdict: FeedbackVerdict; true_category: Category | null } | undefined> {
  const row = await db
    .selectFrom("triage_feedback")
    .select(["id", "verdict", "true_category"])
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    verdict: verdictSchema.parse(row.verdict),
    true_category: row.true_category === null ? null : categorySchema.parse(row.true_category),
  };
}

// The latest triage result of an e-mail and its subject; undefined for an unknown e-mail or one of another org.
export async function getLabelTarget(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string
): Promise<{ category: Category; subject: string | null } | undefined> {
  const row = await db
    .selectFrom("triage_results")
    .innerJoin("emails", (join) =>
      join.onRef("emails.id", "=", "triage_results.email_id").onRef("emails.org_id", "=", "triage_results.org_id")
    )
    .select(["triage_results.category", "emails.subject"])
    .where("triage_results.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    .where("triage_results.email_id", "=", emailId)
    .orderBy("triage_results.created_at", "desc")
    .orderBy("triage_results.id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!row) {
    return undefined;
  }
  return { category: categorySchema.parse(row.category), subject: row.subject };
}

// The latest result per email with no feedback row, newest mail first.
export async function listUnlabeled(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { limit: number; mail: MailKind }
): Promise<UnlabeledResult[]> {
  const rows = await db
    .selectFrom((qb) =>
      qb
        .selectFrom("triage_results")
        .innerJoin("emails", (join) =>
          join.onRef("emails.id", "=", "triage_results.email_id").onRef("emails.org_id", "=", "triage_results.org_id")
        )
        .distinctOn("triage_results.email_id")
        .select([
          "triage_results.email_id",
          "emails.received_at",
          "emails.from_address",
          "emails.subject",
          "triage_results.category",
          "triage_results.confidence",
          "triage_results.reason_code",
          "triage_results.fields",
        ])
        .where("triage_results.org_id", "=", ctx.orgId)
        .where("emails.org_id", "=", ctx.orgId)
        .where("emails.mailbox_id", "=", mailboxId)
        .where(mailKindFilter(opts.mail))
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom("triage_feedback")
                .select("triage_feedback.id")
                .whereRef("triage_feedback.email_id", "=", "triage_results.email_id")
                .where("triage_feedback.org_id", "=", ctx.orgId)
            )
          )
        )
        .orderBy("triage_results.email_id")
        .orderBy("triage_results.created_at", "desc")
        .orderBy("triage_results.id", "desc")
        .as("latest")
    )
    .selectAll()
    .orderBy("received_at", "desc")
    .orderBy("email_id", "desc")
    .limit(opts.limit)
    .execute();
  return rows.map((row) => ({ ...row, category: categorySchema.parse(row.category) }));
}

// The latest result and the latest feedback per email, for emails that have both.
export async function listLabeledResults(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { mail: MailKind }
): Promise<LabeledResult[]> {
  const rows = await db
    .with("latest_result", (qb) =>
      qb
        .selectFrom("triage_results")
        .innerJoin("emails", (join) =>
          join.onRef("emails.id", "=", "triage_results.email_id").onRef("emails.org_id", "=", "triage_results.org_id")
        )
        .distinctOn("triage_results.email_id")
        .select([
          "triage_results.email_id",
          "triage_results.category",
          "triage_results.confidence",
          "triage_results.reason_code",
          "triage_results.model",
          "triage_results.fields",
        ])
        .where("triage_results.org_id", "=", ctx.orgId)
        .where("emails.org_id", "=", ctx.orgId)
        .where("emails.mailbox_id", "=", mailboxId)
        .where(mailKindFilter(opts.mail))
        .orderBy("triage_results.email_id")
        .orderBy("triage_results.created_at", "desc")
        .orderBy("triage_results.id", "desc")
    )
    .with("latest_feedback", (qb) =>
      qb
        .selectFrom("triage_feedback")
        .distinctOn("triage_feedback.email_id")
        .select(["triage_feedback.email_id", "triage_feedback.verdict", "triage_feedback.true_category"])
        .where("triage_feedback.org_id", "=", ctx.orgId)
        .orderBy("triage_feedback.email_id")
        .orderBy("triage_feedback.created_at", "desc")
        .orderBy("triage_feedback.id", "desc")
    )
    .selectFrom("latest_result")
    .innerJoin("latest_feedback", "latest_feedback.email_id", "latest_result.email_id")
    .select([
      "latest_result.email_id",
      "latest_result.category",
      "latest_result.confidence",
      "latest_result.reason_code",
      "latest_result.model",
      "latest_result.fields",
      "latest_feedback.verdict",
      "latest_feedback.true_category",
    ])
    .orderBy("latest_result.email_id")
    .execute();
  return rows.map((row) => ({
    ...row,
    category: categorySchema.parse(row.category),
    verdict: verdictSchema.parse(row.verdict),
    true_category: row.true_category === null ? null : categorySchema.parse(row.true_category),
  }));
}

// Rows with a model (LLM results) created at or after `since`, oldest first.
export async function listUsageSince(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date,
  opts: { mail: MailKind }
): Promise<UsageRow[]> {
  return db
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
    ])
    .where("triage_results.org_id", "=", ctx.orgId)
    .where("emails.org_id", "=", ctx.orgId)
    .where("emails.mailbox_id", "=", mailboxId)
    .where("triage_results.model", "is not", null)
    .where("triage_results.created_at", ">=", since)
    .where(mailKindFilter(opts.mail))
    .orderBy("triage_results.created_at")
    .orderBy("triage_results.id")
    .$narrowType<{ model: NotNull }>()
    .execute();
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
           latest.fields->>'model_category' AS model_category, latest.created_at,
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
  }>`
    WITH latest AS (
      SELECT DISTINCT ON (tr.email_id) tr.email_id, tr.category, tr.confidence, tr.reason_code, tr.reason,
             tr.fields->>'model_category' AS model_category, tr.created_at
      FROM triage_results tr
      JOIN emails e ON e.id = tr.email_id AND e.org_id = ${orgId}
      WHERE tr.org_id = ${orgId} AND e.received_at >= ${q.since} ${mailboxFilter}
      ORDER BY tr.email_id, tr.created_at DESC, tr.id DESC
    )
    SELECT latest.email_id, latest.category, latest.confidence, latest.reason_code, latest.reason,
           latest.model_category, latest.created_at,
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
    triaged_at: created_at,
  }));
}

export interface LatestFeedbackRow {
  verdict: FeedbackVerdict;
  true_category: Category | null;
  source: FeedbackSource;
  created_at: Date;
}

const feedbackSourceSchema = z.enum(feedbackSources);

// The latest feedback row per mail (created_at desc, id desc), in chunks of 500 ids.
export async function listLatestFeedbackByEmailIds(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Map<string, LatestFeedbackRow>> {
  const out = new Map<string, LatestFeedbackRow>();
  for (let i = 0; i < emailIds.length; i += 500) {
    const rows = await db
      .selectFrom("triage_feedback")
      .distinctOn("email_id")
      .select(["email_id", "verdict", "true_category", "source", "created_at"])
      .where("org_id", "=", ctx.orgId)
      .where("email_id", "in", emailIds.slice(i, i + 500))
      .orderBy("email_id")
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute();
    for (const row of rows) {
      out.set(row.email_id, {
        verdict: verdictSchema.parse(row.verdict),
        true_category: row.true_category === null ? null : categorySchema.parse(row.true_category),
        source: feedbackSourceSchema.parse(row.source),
        created_at: row.created_at,
      });
    }
  }
  return out;
}

const RETENTION_BATCH = 1000;

// Retention (A23): the reason text and the extracted fields go after the period. Batches by id; a locked row waits for a later day.
export async function clearTriageTexts(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await db
      .updateTable("triage_results")
      .set({ reason: null, fields: sql`'{}'::jsonb` })
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        db
          .selectFrom("triage_results")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("created_at", "<", opts.before)
          .where((eb) => eb.or([eb("reason", "is not", null), sql<boolean>`fields <> '{}'::jsonb`]))
          .orderBy("id")
          .limit(batch)
          .forUpdate()
          .skipLocked()
      )
      .executeTakeFirstOrThrow();
    const changed = Number(result.numUpdatedRows);
    total += changed;
    if (changed === 0) return total;
  }
}
