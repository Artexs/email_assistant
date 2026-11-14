// Row reader of the cost metric (M7). It counts every `llm.call` row of the organization, also of test mail.
import type { LlmCallRow, WeekQuery } from "@ea/core";
import { sql, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";

type DbOrTrx = Db | Transaction<DB>;

const rowSchema = z.object({
  mailbox_id: z.string().nullable(),
  model: z.string().nullable(),
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
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      at: row.at,
    };
  });
}
