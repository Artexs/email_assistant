import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

const RETENTION_BATCH = 1000;
// A pending mail that no job took in this time loses its body at the retention run (A23).
export const PENDING_BODY_DAYS = 7;
// Retention (A23). Each loop updates one batch of rows by id and skips rows a job holds (a later day clears them).
// A repeat call changes nothing: every rule excludes cleared rows. No filter on the mailbox status, the plan or the triage scope.
// A `processing` row is cleared only when its lock is older than both periods: a live run never holds a lock that long,
// so such a row is stuck (the worker does not run for a paused mailbox, a suspended organization or scope `off`).
export async function clearMailBodies(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; pendingBefore: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await db
      .updateTable("emails")
      .set({ body_text: null })
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        db
          .selectFrom("emails")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("body_text", "is not", null)
          .where("created_at", "<", opts.before)
          .where((eb) =>
            eb.or([
              eb("status", "<>", "processing"),
              eb.and([eb("locked_at", "<", opts.before), eb("locked_at", "<", opts.pendingBefore)]),
            ])
          )
          .where((eb) => eb.or([eb("status", "<>", "pending"), eb("created_at", "<", opts.pendingBefore)]))
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
export async function clearMailHeaders(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await db
      .updateTable("emails")
      .set({
        subject: null,
        from_address: null,
        to_addresses: sql`'{}'`,
        cc_addresses: sql`'{}'`,
        in_reply_to: null,
        references_header: null,
      })
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        db
          .selectFrom("emails")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("created_at", "<", opts.before)
          .where((eb) =>
            eb.or([
              eb("subject", "is not", null),
              eb("from_address", "is not", null),
              eb("to_addresses", "<>", sql<string[]>`'{}'`),
              eb("cc_addresses", "<>", sql<string[]>`'{}'`),
              eb("in_reply_to", "is not", null),
              eb("references_header", "is not", null),
            ])
          )
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
