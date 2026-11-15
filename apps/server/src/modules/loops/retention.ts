import type { TenantContext } from "../../platform/db";

import type { DbOrTrx } from "./repo";

const RETENTION_BATCH = 1000;

// The columns that hold mail text or a person's address. `texts_cleared_at` says they are gone.
export function clearedTexts(at: Date) {
  return {
    subject: null,
    text: null,
    to_addresses: [] as string[],
    cc_addresses: [] as string[],
    counterpart: null,
    texts_cleared_at: at,
    updated_at: at,
  };
}

// Retention: the texts of a loop go 90 days after it closed (`before` = now - 90 days). Only closed loops: an open
// loop keeps its subject and ask, because the chaser and the brief read them while the loop lives; its Sent mail may be
// cleared before, so the loop copy is the only one left. Batches by id with `FOR UPDATE SKIP LOCKED`; a locked row waits
// for the next day. A repeat call changes nothing. The `thread_key` and the Message-IDs stay: opaque ids, no address.
export async function clearLoopTexts(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number; now?: Date }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  const at = opts.now ?? new Date();
  let total = 0;
  for (;;) {
    const result = await db
      .updateTable("open_loops")
      .set(clearedTexts(at))
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        db
          .selectFrom("open_loops")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("status", "=", "closed")
          .where("closed_at", "<", opts.before)
          .where("texts_cleared_at", "is", null)
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
