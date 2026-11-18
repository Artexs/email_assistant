import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";

const RETENTION_BATCH = 1000;

// Retention: the instruction and the sample text of a request go after the text period of `docs/architecture.md` §7
// (`before` = now - `RETENTION_TEXT_DAYS`, counted from `created_at`). The text period is the same for every organization:
// it is not `data_retention_days`. One column decides, `created_at`: a text is written when the row is made (the instruction)
// or when the sample is done, and a claim, a release or any other update moves `updated_at` but never makes a text newer.
// The clearing itself never moves `updated_at`: for a request of a user that column is the time it ended, and the answer in the chat
// reads it (a moved value would look like a new end, and the user would get an answer about a draft of 90 days ago).
// The row stays (codes and times). A row with both texts null is not touched, so a repeat run changes nothing. A row of
// any status is cleared: an open request that old is dead. Batches of 1 000 by id with `FOR UPDATE SKIP LOCKED`; a locked
// row waits for the next day.
export async function clearReplyTexts(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  opts: { before: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await db
      .updateTable("reply_requests")
      .set({ instruction: null, sample_body: null })
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        db
          .selectFrom("reply_requests")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("created_at", "<", opts.before)
          .where((eb) => eb.or([eb("instruction", "is not", null), eb("sample_body", "is not", null)]))
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
