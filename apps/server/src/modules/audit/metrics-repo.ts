// Row reader of the cost metric (M7). It counts every `llm.call` row of the organization, also of test mail.
import { type LlmCallRow, toEndpointKind, type WeekQuery } from "@ea/core";
import { sql, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

const rowSchema = z.object({
  mailbox_id: z.string().nullable(),
  model: z.string().nullable(),
  endpoint: z.string().nullable(),
  tokens_in: z.number().nullable(),
  tokens_out: z.number().nullable(),
  at: z.date(),
});

// A JSON number or null: any other JSON type reads as null.
const jsonNumber = (key: string) =>
  sql`CASE WHEN jsonb_typeof(data->${key}) = 'number' THEN (data->>${key})::float8 END`;

/** `llm.call` rows in the range, one per call, with the time of the call. `mailboxId` filters the `data` key. */
export async function listLlmCallRows(
  db: DbOrTrx,
  ctx: TenantContext,
  q: Omit<WeekQuery, "testMail">
): Promise<LlmCallRow[]> {
  const mailbox = q.mailboxId === null ? sql`true` : sql`data->>'mailbox_id' = ${q.mailboxId}`;
  const { rows } = await sql<unknown>`
    SELECT data->>'mailbox_id' AS mailbox_id,
      CASE WHEN jsonb_typeof(data->'model') = 'string' THEN data->>'model' END AS model,
      CASE WHEN jsonb_typeof(data->'endpoint') = 'string' THEN data->>'endpoint' END AS endpoint,
      ${jsonNumber("tokens_in")} AS tokens_in,
      ${jsonNumber("tokens_out")} AS tokens_out,
      created_at AS at
    FROM audit_log
    WHERE org_id = ${ctx.orgId} AND event = 'llm.call'
      AND created_at >= ${q.range.start} AND created_at < ${q.range.end}
      AND ${mailbox}
    ORDER BY created_at, id
  `.execute(db);
  return rows.map((raw) => {
    const row = rowSchema.parse(raw);
    return {
      mailboxId: row.mailbox_id,
      model: row.model,
      endpoint: toEndpointKind(row.endpoint),
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      at: row.at,
    };
  });
}

const countSchema = z.object({ value: z.string().nullable(), count: z.number() });

/**
 * The rows of one event in the range, counted by one string key of their `data` (for example the `limit` of
 * `action.send_limited`). `mailboxId` filters `data.mailbox_id`. A row with no such key counts under `""`.
 */
export async function countEventsByDataKey(
  db: DbOrTrx,
  ctx: TenantContext,
  q: { event: string; key: string; range: { start: Date; end: Date }; mailboxId: string }
): Promise<Map<string, number>> {
  const { rows } = await sql<unknown>`
    SELECT data->>${q.key} AS value, count(*)::int AS count
    FROM audit_log
    WHERE org_id = ${ctx.orgId} AND event = ${q.event}
      AND created_at >= ${q.range.start} AND created_at < ${q.range.end}
      AND data->>'mailbox_id' = ${q.mailboxId}
    GROUP BY 1
  `.execute(db);
  const counts = new Map<string, number>();
  for (const raw of rows) {
    const row = countSchema.parse(raw);
    counts.set(row.value ?? "", row.count);
  }
  return counts;
}
