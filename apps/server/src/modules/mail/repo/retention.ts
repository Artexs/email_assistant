import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

const RETENTION_BATCH = 1000;
// A pending mail that no job took in this time loses its body at the retention run.
export const PENDING_BODY_DAYS = 7;
// Retention. Each loop updates one batch of rows by id and skips rows a job holds (a later day clears them).
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

// Retention of the stored Sent text. The window runs from the INTERNALDATE in Sent, not from the store time: the first pass stores
// mail up to 30 days old, so a store-time window would keep its text up to 60 days. The row stays: `content` stays `stored`,
// and the answer reader needs the ids and the times. A repeat call changes nothing.
export async function clearSentBodies(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await db
      .updateTable("sent_emails")
      .set({ body_text: null, updated_at: sql`now()` })
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        db
          .selectFrom("sent_emails")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("body_text", "is not", null)
          .where("internal_date", "<", opts.before)
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

// Retention of the Sent subject and addresses, from the INTERNALDATE. The row keeps its ids (Message-ID, parent, thread, dedup key)
// and its times: the "answered by the user" reader works without the headers. Counts only rows that still hold a value.
export async function clearSentHeaders(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await db
      .updateTable("sent_emails")
      .set({
        subject: null,
        from_address: null,
        to_addresses: sql`'{}'`,
        cc_addresses: sql`'{}'`,
        references_ids: sql`'{}'`,
        updated_at: sql`now()`,
      })
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        db
          .selectFrom("sent_emails")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("internal_date", "<", opts.before)
          .where((eb) =>
            eb.or([
              eb("subject", "is not", null),
              eb("from_address", "is not", null),
              eb("to_addresses", "<>", sql<string[]>`'{}'`),
              eb("cc_addresses", "<>", sql<string[]>`'{}'`),
              eb("references_ids", "<>", sql<string[]>`'{}'`),
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

// Retention: sign-in states of the OAuth flow that expired before `before` (the caller passes now − 1 h) are deleted.
// A state is single use and lives 10 minutes; the grace keeps a row a short time for a support look.
export async function deleteOldOAuthStates(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await db
      .deleteFrom("mailbox_oauth_states")
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        db
          .selectFrom("mailbox_oauth_states")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("expires_at", "<", opts.before)
          .orderBy("id")
          .limit(batch)
          .forUpdate()
          .skipLocked()
      )
      .executeTakeFirst();
    const changed = Number(result.numDeletedRows);
    total += changed;
    if (changed === 0) return total;
  }
}
