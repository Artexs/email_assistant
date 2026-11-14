import { sql, type Expression, type ExpressionBuilder, type SqlBool } from "kysely";

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
