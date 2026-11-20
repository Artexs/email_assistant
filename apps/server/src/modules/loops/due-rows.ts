// Row reader of the open-loops metric (M2) for loops. Dates, ids and codes only: no text, no address.
import { normalizeAddress, type LoopDueRow } from "@ea/core";
import { sql } from "kysely";
import { z } from "zod";

import { normalizedAddress, type TenantContext } from "../../platform/db";
import { SYNTHETIC_MESSAGE_ID_LIKE, type TestMailRule } from "../mail";

import { loopKindSchema, type DbOrTrx } from "./repo";

const rowSchema = z.object({
  id: z.string(),
  kind: loopKindSchema,
  due_at: z.date(),
  surfaced_at: z.date().nullable(),
  closed_at: z.date().nullable(),
  close_reason: z.string().nullable(),
  first_follow_up_at: z.date().nullable(),
});

/**
 * The loops whose current due time is in the range. `closed_at` and `close_reason` are null on an open loop (the table
 * check); a reopened loop is open again. `firstFollowUpAt` is the first applied `send` of the loop (the follow-up).
 * Real mail only: a loop that opens with a synthetic Message-ID, or whose counterpart is a test sender, is left out.
 * The counterpart is null once the texts are cleared; such a loop is closed long ago and keeps its place.
 */
export async function loopDueRows(
  db: DbOrTrx,
  ctx: TenantContext,
  q: { range: { start: Date; end: Date }; mailboxId?: string | null; testMail?: TestMailRule }
): Promise<LoopDueRow[]> {
  const mailbox = q.mailboxId == null ? sql`true` : sql`l.mailbox_id = ${q.mailboxId}`;
  const senders = q.testMail?.senders ?? [];
  const testSender =
    senders.length === 0
      ? sql`false`
      : sql`${normalizedAddress("l.counterpart")} in (${sql.join(senders.map(normalizeAddress))})`;
  // not an address: the synthetic message id marker
  const realMessage = sql`(l.message_id IS NULL OR l.message_id NOT ILIKE ${SYNTHETIC_MESSAGE_ID_LIKE})`;
  const { rows } = await sql<unknown>`
    SELECT l.id, l.kind, l.due_at, l.surfaced_at, l.closed_at, l.close_reason,
      (
        SELECT MIN(a.applied_at) FROM actions a
        WHERE a.org_id = ${ctx.orgId} AND a.loop_id = l.id AND a.type = 'send' AND a.status = 'applied'
      ) AS first_follow_up_at
    FROM open_loops l
    WHERE l.org_id = ${ctx.orgId}
      AND l.due_at >= ${q.range.start} AND l.due_at < ${q.range.end}
      AND ${mailbox}
      AND ${realMessage}
      AND NOT COALESCE(${testSender}, false)
    ORDER BY l.due_at, l.id
  `.execute(db);
  return rows.map((raw) => {
    const row = rowSchema.parse(raw);
    return {
      id: row.id,
      kind: row.kind,
      dueAt: row.due_at,
      surfacedAt: row.surfaced_at,
      closedAt: row.closed_at,
      closeReason: row.close_reason,
      firstFollowUpAt: row.first_follow_up_at,
    };
  });
}
