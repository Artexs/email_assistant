import { sql, type Transaction, type Expression, type ExpressionBuilder, type SqlBool } from "kysely";

import type { DB, TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

const RETENTION_BATCH = 1000;
// Types whose payload holds text of the mail or of a draft (A23).
const PAYLOAD_TYPES = ["save_summary", "create_draft", "send"];
const CLOSED_STATUSES = ["applied", "expired", "failed", "rejected", "undone", "logged"];
// A row that matches the rule keeps its payload. The composition root passes it (`retention.ts`), so `actions`
// does not need to know when another module still reads a payload (the hooks pattern, read side).
export type PayloadKeepRule = (eb: ExpressionBuilder<DB, "actions">, ctx: TenantContext) => Expression<SqlBool>;
// Retention (docs/architecture.md §7): the payload of a closed `save_summary`, `create_draft` or `send` row, and of a `ready` `save_summary`, goes after the period.
// An `applying` `create_draft` or `send` row goes too when its last change is older than the period: the committer
// recovers such a row only for a mailbox it still visits, so it can be stuck (a paused mailbox, a suspended organization,
// scope `off`). A recovery of a cleared row ends as `failed` (bad payload).
// Other open `create_draft` and `send` rows are not touched. A row that matches `opts.keep` keeps its payload
// (`retention.ts` passes the open-delegation rule of `delegation`). Status and `updated_at` stay. Batches by id; a locked row waits for a later day.
export async function clearActionPayloads(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number; keep: PayloadKeepRule }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await db
      .updateTable("actions")
      .set({ payload: sql`'{}'::jsonb` })
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        db
          .selectFrom("actions")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("created_at", "<", opts.before)
          .where(sql<boolean>`payload <> '{}'::jsonb`)
          .where("type", "in", PAYLOAD_TYPES)
          .where((eb) =>
            eb.or([
              eb("status", "in", CLOSED_STATUSES),
              eb.and([eb("type", "=", "save_summary"), eb("status", "=", "ready")]),
              eb.and([eb("status", "=", "applying"), eb("updated_at", "<", opts.before)]),
            ])
          )
          .where((eb) => eb.not(opts.keep(eb, ctx)))
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
// The keys of a follow-up payload that copy the Sent mail: its text (`quote`), its recipients and its subject.
const SENT_COPY_KEYS = ["quote", "to", "cc", "subject"];

// "Track my sent mail" went off: the copies of the Sent mail in the `create_draft` and `send` rows of every loop of the
// mailbox (a panel edit's successor included) lose these keys. The row, its status and the other keys stay (`kind`,
// `loop_id`: the reverse of a draft in the Drafts folder reads them). A send that was approved and not yet claimed ended
// `expired` before this call (`expireFollowUpSends`), so it sends nothing. A send that the committer already holds
// (`applying`) finishes: the mail goes out from the payload that the committer holds in memory, which is the accepted rule
// "an applying send finishes". Only a claim that reads the payload after this commit meets a payload with no recipient and
// fails as a bad payload. The caller holds the transaction of the switch; the loops are locked before (loop first, then
// sends). Returns the row count.
export async function clearLoopSentCopies(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: { mailboxId: string }
): Promise<number> {
  const result = await trx
    .updateTable("actions")
    .set({ payload: sql`payload - ${sql.raw(SENT_COPY_KEYS.map((key) => `'${key}'`).join(" - "))}` })
    .where("org_id", "=", ctx.orgId)
    .where("type", "in", ["create_draft", "send"])
    .where(
      "loop_id",
      "in",
      trx
        .selectFrom("open_loops")
        .select("id")
        .where("org_id", "=", ctx.orgId)
        .where("mailbox_id", "=", input.mailboxId)
    )
    .where(
      sql<boolean>`jsonb_exists_any(payload, ${sql.raw(`array[${SENT_COPY_KEYS.map((key) => `'${key}'`).join(",")}]`)})`
    )
    .executeTakeFirstOrThrow();
  return Number(result.numUpdatedRows);
}
// Retention (A23): the error text goes 90 days after the last change. Status and `updated_at` stay.
export async function clearActionErrors(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await db
      .updateTable("actions")
      .set({ last_error: null })
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        db
          .selectFrom("actions")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("updated_at", "<", opts.before)
          .where("last_error", "is not", null)
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
