import { categorySchema, type Category } from "@ea/core";
import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

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
  // Codes of `suspiciousReasons`; default none.
  suspiciousReasons?: readonly string[];
}
export interface LatestTriageResult {
  id: string;
  category: Category;
  confidence: number;
  reason_code: string;
  model: string | null;
  fields: unknown;
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
      suspicious_reasons: [...(row.suspiciousReasons ?? [])],
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
/** The newest `triage_results` row of each mail with the fields that the history check reuses: the key of the run and the VIP mark. */
export interface StoredResultRow {
  emailId: string;
  category: Category;
  confidence: number;
  reasonCode: string;
  model: string | null;
  promptVersion: string | null;
  vip: boolean;
}
export async function listNewestResultsOf(
  db: DbOrTrx,
  ctx: TenantContext,
  emailIds: readonly string[]
): Promise<Map<string, StoredResultRow>> {
  const out = new Map<string, StoredResultRow>();
  for (let i = 0; i < emailIds.length; i += 500) {
    const rows = await db
      .selectFrom("triage_results")
      .distinctOn("email_id")
      .select(["email_id", "category", "confidence", "reason_code", "model", "prompt_version", "vip"])
      .where("org_id", "=", ctx.orgId)
      .where("email_id", "in", emailIds.slice(i, i + 500))
      .orderBy("email_id")
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute();
    for (const row of rows) {
      out.set(row.email_id, {
        emailId: row.email_id,
        category: categorySchema.parse(row.category),
        confidence: row.confidence,
        reasonCode: row.reason_code,
        model: row.model,
        promptVersion: row.prompt_version,
        vip: row.vip,
      });
    }
  }
  return out;
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
const RETENTION_BATCH = 1000;
// Retention: the reason text and the extracted fields go after the period. Batches by id; a locked row waits for a later day.
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
// The newest triage result of the organization, null when none.
export async function lastTriageAt(db: DbOrTrx, ctx: TenantContext): Promise<Date | null> {
  const row = await db
    .selectFrom("triage_results")
    .select("created_at")
    .where("org_id", "=", ctx.orgId)
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();
  return row?.created_at ?? null;
}
