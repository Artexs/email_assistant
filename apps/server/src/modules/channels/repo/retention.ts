import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import { OUTBOX_REMOVED_TEXT } from "./outbox";
import type { DbOrTrx } from "./shared";

const RETENTION_BATCH = 1000;
// Retention: the text and the view of an old message go after the period. Two rules:
// - a `sent` or `failed` row gets the text `[removed]` (its `error_code` stays);
// - a `pending` or `sending` row also becomes `failed` / `expired`: the row of a suspended organization is never claimed,
//   and a message of that age must not go out at a resume.
// Batches by id; a locked row waits for a later day. A repeat call changes nothing.
export async function clearOutboxTexts(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await db
      .updateTable("outbox")
      .set({ text: OUTBOX_REMOVED_TEXT, view: JSON.stringify({}) })
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        db
          .selectFrom("outbox")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("created_at", "<", opts.before)
          .where("status", "in", ["sent", "failed"])
          .where((eb) =>
            eb.or([eb("text", "is distinct from", OUTBOX_REMOVED_TEXT), sql<boolean>`view <> '{}'::jsonb`])
          )
          .orderBy("id")
          .limit(batch)
          .forUpdate()
          .skipLocked()
      )
      .executeTakeFirstOrThrow();
    const changed = Number(result.numUpdatedRows);
    total += changed;
    if (changed === 0) break;
  }
  for (;;) {
    const result = await db
      .updateTable("outbox")
      .set({
        status: "failed",
        error_code: "expired",
        locked_at: null,
        text: OUTBOX_REMOVED_TEXT,
        view: JSON.stringify({}),
      })
      .where("org_id", "=", ctx.orgId)
      .where(
        "id",
        "in",
        db
          .selectFrom("outbox")
          .select("id")
          .where("org_id", "=", ctx.orgId)
          .where("created_at", "<", opts.before)
          .where("status", "in", ["pending", "sending"])
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
// Retention: link tokens used or expired before `before` (the caller passes now − 1 d) are deleted.
// The table has no `id`; its key is `token_hash`.
export async function deleteOldLinkTokens(
  db: DbOrTrx,
  ctx: TenantContext,
  opts: { before: Date; batch?: number }
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH;
  let total = 0;
  for (;;) {
    const result = await db
      .deleteFrom("chat_link_tokens")
      .where("org_id", "=", ctx.orgId)
      .where(
        "token_hash",
        "in",
        db
          .selectFrom("chat_link_tokens")
          .select("token_hash")
          .where("org_id", "=", ctx.orgId)
          .where((eb) => eb.or([eb("used_at", "<", opts.before), eb("expires_at", "<", opts.before)]))
          .orderBy("token_hash")
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
