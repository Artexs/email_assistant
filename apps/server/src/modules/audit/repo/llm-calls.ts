import { toEndpointKind, type LlmEndpointKind, type LlmProviderId, type LlmRole } from "@ea/core";
import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import { recordAudit } from "./audit";
import { auditEvents } from "./events";
import type { DbOrTrx } from "./shared";

/** One LLM call attempt. Ids, codes and numbers only: never the prompt or the answer. */
export interface LlmCallRecord {
  emailId?: string;
  mailboxId: string;
  role: LlmRole;
  promptVersion: string;
  model: string;
  /** Where the call ran. A success takes it from `LlmUsage.endpoint`, an error from `LlmClient.endpointOf(role)`. */
  endpoint: LlmEndpointKind;
  /** The provider row of the role. A success takes it from `LlmUsage.provider`, an error from `LlmClient.providerOf(role)`. */
  provider: LlmProviderId;
  /** `ok` or the LLM error code. */
  outcome: string;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  at: Date;
  /** The call belongs to a history check: the daily cap leaves it out, the cost reports count it. */
  historyCheckId?: string;
}
// The key of `llm.call` data that marks a call of a history check.
export const HISTORY_CHECK_KEY = "historyCheckId";
// Every LLM call writes one `llm.call` row here: the daily cap and the cost per role read these rows.
export async function recordLlmCall(db: DbOrTrx, ctx: TenantContext, call: LlmCallRecord): Promise<void> {
  await recordAudit(db, ctx, {
    emailId: call.emailId,
    actor: "system",
    event: auditEvents.llmCall,
    reasonCode: call.outcome,
    data: {
      mailbox_id: call.mailboxId,
      role: call.role,
      model: call.model,
      endpoint: call.endpoint,
      provider: call.provider,
      prompt_version: call.promptVersion,
      tokens_in: call.tokensIn,
      tokens_out: call.tokensOut,
      latency_ms: call.latencyMs,
      ...(call.historyCheckId === undefined ? {} : { [HISTORY_CHECK_KEY]: call.historyCheckId }),
    },
    at: call.at,
  });
}
// `llm.call` rows of the organization at or after `since`, per model (no model: "unknown").
export async function sumLlmCallsByModelSince(
  db: DbOrTrx,
  ctx: TenantContext,
  since: Date
): Promise<{ model: string; endpoint: LlmEndpointKind; calls: number; tokensIn: number; tokensOut: number }[]> {
  const model = sql<string>`coalesce(data->>'model', 'unknown')`;
  // A row written before the endpoint was logged has no `endpoint` key: it ran on the standard endpoint.
  const endpoint = sql<string>`coalesce(data->>'endpoint', 'standard')`;
  const rows = await db
    .selectFrom("audit_log")
    .select([
      model.as("model"),
      endpoint.as("endpoint"),
      sql<string>`count(*)`.as("calls"),
      sql<string>`coalesce(sum((data->>'tokens_in')::bigint), 0)`.as("tokens_in"),
      sql<string>`coalesce(sum((data->>'tokens_out')::bigint), 0)`.as("tokens_out"),
    ])
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", auditEvents.llmCall)
    .where("created_at", ">=", since)
    .groupBy([model, endpoint])
    .orderBy(model)
    .orderBy(endpoint)
    .execute();
  return rows.map((row) => ({
    model: row.model,
    endpoint: toEndpointKind(row.endpoint),
    calls: Number(row.calls),
    tokensIn: Number(row.tokens_in),
    tokensOut: Number(row.tokens_out),
  }));
}
// The same sums for every organization at once, grouped by organization. Inside one organization the rows keep the order of
// `sumLlmCallsByModelSince` (model, then endpoint). An organization with no call has no entry.
export async function sumLlmCallsByModelSinceOfAll(
  db: DbOrTrx,
  since: Date
): Promise<Map<string, Awaited<ReturnType<typeof sumLlmCallsByModelSince>>>> {
  const model = sql<string>`coalesce(data->>'model', 'unknown')`;
  const endpoint = sql<string>`coalesce(data->>'endpoint', 'standard')`;
  const rows = await db
    .selectFrom("audit_log")
    .select([
      "org_id",
      model.as("model"),
      endpoint.as("endpoint"),
      sql<string>`count(*)`.as("calls"),
      sql<string>`coalesce(sum((data->>'tokens_in')::bigint), 0)`.as("tokens_in"),
      sql<string>`coalesce(sum((data->>'tokens_out')::bigint), 0)`.as("tokens_out"),
    ])
    .where("event", "=", auditEvents.llmCall)
    .where("created_at", ">=", since)
    .groupBy(["org_id", model, endpoint])
    .orderBy("org_id")
    .orderBy(model)
    .orderBy(endpoint)
    .execute();
  const byOrg = new Map<string, Awaited<ReturnType<typeof sumLlmCallsByModelSince>>>();
  for (const row of rows) {
    const list = byOrg.get(row.org_id) ?? [];
    list.push({
      model: row.model,
      endpoint: toEndpointKind(row.endpoint),
      calls: Number(row.calls),
      tokensIn: Number(row.tokens_in),
      tokensOut: Number(row.tokens_out),
    });
    byOrg.set(row.org_id, list);
  }
  return byOrg;
}
// The `llm.call` rows of the style preview: the calls of one mailbox with this prompt version that belong to no mail
// (`email_id` is null), at or after `since`. A preview makes one row per call, so a retry inside one preview counts twice.
export async function countMaillessCallsSince(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date,
  promptVersion: string
): Promise<number> {
  const row = await db
    .selectFrom("audit_log")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", auditEvents.llmCall)
    .where("email_id", "is", null)
    .where(sql<string>`data->>'mailbox_id'`, "=", mailboxId)
    .where(sql<string>`data->>'prompt_version'`, "=", promptVersion)
    .where("created_at", ">=", since)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
// One `llm.call` row per LLM call attempt; the mailbox id is in `data`, so no join to `emails`.
// With a role: rows of that role; rows without a role count as classifier rows (written before roles existed).
// The calls of history checks are not counted: the daily cap holds triage and the loop analysis, and a check has its own cap.
export async function countLlmCallsSince(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date,
  opts: { role?: LlmRole } = {}
): Promise<number> {
  let query = db
    .selectFrom("audit_log")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", auditEvents.llmCall)
    .where(sql<string>`data->>'mailbox_id'`, "=", mailboxId)
    .where(sql<string | null>`data->>${sql.lit(HISTORY_CHECK_KEY)}`, "is", null)
    .where("created_at", ">=", since);
  const { role } = opts;
  if (role === "classifier") {
    query = query.where((eb) =>
      eb.or([eb(sql<string>`data->>'role'`, "=", role), eb(sql<string>`data->>'role'`, "is", null)])
    );
  } else if (role !== undefined) {
    query = query.where(sql<string>`data->>'role'`, "=", role);
  }
  const row = await query.executeTakeFirstOrThrow();
  return Number(row.count);
}
// The `llm.call` rows of one mailbox, written at or after `since`, for mail stored in one folder (`emails.source_folder`).
// Like `countLlmCallsSince`, it leaves out the calls of history checks. A mail that is gone has no row left to count.
export async function countLlmCallsOfFolderSince(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date,
  sourceFolder: string
): Promise<number> {
  const row = await db
    .selectFrom("audit_log")
    .innerJoin("emails", "emails.id", "audit_log.email_id")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("audit_log.org_id", "=", ctx.orgId)
    .where("audit_log.event", "=", auditEvents.llmCall)
    .where(sql<string>`audit_log.data->>'mailbox_id'`, "=", mailboxId)
    .where(sql<string | null>`audit_log.data->>${sql.lit(HISTORY_CHECK_KEY)}`, "is", null)
    .where("audit_log.created_at", ">=", since)
    .where("emails.org_id", "=", ctx.orgId)
    .where("emails.source_folder", "=", sourceFolder)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
// The `llm.call` rows of the history checks of one mailbox, written at or after `since`: the calls that `countLlmCallsSince` leaves out.
// The operator reads them next to the daily count, because the daily cap does not hold them (a check has its own cap).
export async function countHistoryLlmCallsSince(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date
): Promise<number> {
  const row = await db
    .selectFrom("audit_log")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("event", "=", auditEvents.llmCall)
    .where(sql<string>`data->>'mailbox_id'`, "=", mailboxId)
    .where(sql<string | null>`data->>${sql.lit(HISTORY_CHECK_KEY)}`, "is not", null)
    .where("created_at", ">=", since)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
// SLO job entry point: no TenantContext. The `llm.call` rows of all organizations that are not `suspended`, written at or
// after `since`: how many, and how many with an outcome other than `ok`. Counts only; no id, no text. The name differs from
// `countLlmCallsSince` (one mailbox) on purpose.
export async function countLlmCallOutcomesSince(db: DbOrTrx, since: Date): Promise<{ total: number; failed: number }> {
  const row = await db
    .selectFrom("audit_log")
    .innerJoin("organizations", "organizations.id", "audit_log.org_id")
    .select([
      (eb) => eb.fn.countAll<string>().as("total"),
      sql<string>`count(*) filter (where audit_log.reason_code <> 'ok')`.as("failed"),
    ])
    .where("audit_log.event", "=", auditEvents.llmCall)
    .where("audit_log.created_at", ">=", since)
    .where("organizations.plan", "<>", "suspended")
    .executeTakeFirstOrThrow();
  return { total: Number(row.total), failed: Number(row.failed) };
}
