import { noticeViewSchemas } from "@ea/core";
import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";
import { releaseBriefMarks } from "../../loops";

import type { DbOrTrx } from "./shared";

// A digest that ended `failed` never showed its brief lines: their marks go back. The row keeps its view
// (`loopIds`), so the next digest names the loops again and no other digest has to. `except`: loops whose marks stay (a loop that is
// being cleared; its mark does not matter any more).
export async function releaseMarksOfFailedDigests(
  db: DbOrTrx,
  ctx: TenantContext,
  rows: readonly { id: string; kind: string; view: unknown; created_at: Date }[],
  except: ReadonlySet<string> = new Set()
): Promise<void> {
  for (const row of rows) {
    if (row.kind !== "digest") continue;
    const view = noticeViewSchemas.digest.safeParse(row.view);
    const loopIds = (view.success ? (view.data.loopIds ?? []) : []).filter((id) => !except.has(id));
    await releaseBriefMarks(db, ctx, { outboxId: row.id, loopIds, at: row.created_at });
  }
}
// The digests that no sender delivered (`pending`, `sending`) and that a delete or a blanking is about to end (the Sent switch off,
// an erase): their marks go back before the view is blanked or the row is deleted. `named`: only the digests that name
// one of these loops. `since`: only the digests created at or after this time. `except`: the loops that are being cleared keep their
// marks. The caller holds the transaction and calls this before the update or the delete, while the views are still there.
export async function releaseMarksOfUndeliveredDigests(
  db: DbOrTrx,
  ctx: TenantContext,
  filter: { named?: readonly string[]; since?: Date; except?: readonly string[] }
): Promise<void> {
  if (filter.named?.length === 0) return;
  let query = db
    .selectFrom("outbox")
    .select(["id", "kind", "view", "created_at"])
    .where("org_id", "=", ctx.orgId)
    .where("kind", "=", "digest")
    .where("status", "in", ["pending", "sending"]);
  if (filter.since !== undefined) query = query.where("created_at", ">=", filter.since);
  if (filter.named !== undefined) {
    const named = [...filter.named];
    query = query.where(
      sql<boolean>`jsonb_typeof(view->'loopIds') = 'array' and exists (
        select 1 from unnest(${named}::text[]) as l(id) where jsonb_exists(view->'loopIds', l.id))`
    );
  }
  await releaseMarksOfFailedDigests(db, ctx, await query.execute(), new Set(filter.except ?? []));
}
