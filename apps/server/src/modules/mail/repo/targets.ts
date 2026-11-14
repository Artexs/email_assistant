import type { MailboxStatus } from "./mailboxes";
import type { DbOrTrx } from "./shared";

// Scheduler entry point: lists work across tenants, so it takes no TenantContext. Callers build a TenantContext from orgId for every later call.
// A `suspended` organization is skipped unless `includeSuspended` (D4: only the approval expiry runs for it).
export async function listMailboxTargets(
  db: DbOrTrx,
  opts: { statuses: readonly MailboxStatus[]; includeSuspended: boolean }
): Promise<{ orgId: string; mailboxId: string }[]> {
  if (opts.statuses.length === 0) return [];
  let query = db
    .selectFrom("mailboxes")
    .innerJoin("organizations", "organizations.id", "mailboxes.org_id")
    .select(["mailboxes.org_id", "mailboxes.id"])
    .where("mailboxes.status", "in", opts.statuses);
  if (!opts.includeSuspended) query = query.where("organizations.plan", "<>", "suspended");
  const rows = await query.orderBy("mailboxes.created_at").orderBy("mailboxes.id").execute();
  return rows.map((row) => ({ orgId: row.org_id, mailboxId: row.id }));
}
// Operator job entry point: no TenantContext. Mailboxes in `auth_error` since `before` or earlier, of organizations that are not `suspended`.
export async function listAuthErrorMailboxesBefore(
  db: DbOrTrx,
  before: Date
): Promise<{ orgId: string; mailboxId: string; statusChangedAt: Date }[]> {
  const rows = await db
    .selectFrom("mailboxes")
    .innerJoin("organizations", "organizations.id", "mailboxes.org_id")
    .select(["mailboxes.org_id", "mailboxes.id", "mailboxes.status_changed_at"])
    .where("mailboxes.status", "=", "auth_error")
    .where("mailboxes.status_changed_at", "<=", before)
    .where("organizations.plan", "<>", "suspended")
    .orderBy("mailboxes.created_at")
    .orderBy("mailboxes.id")
    .execute();
  return rows.map((row) => ({ orgId: row.org_id, mailboxId: row.id, statusChangedAt: row.status_changed_at }));
}
// The gate of sync, triage, committer, returned and chaser: active mailboxes of organizations that are not `suspended`.
export function listSyncTargets(db: DbOrTrx): Promise<{ orgId: string; mailboxId: string }[]> {
  return listMailboxTargets(db, { statuses: ["active"], includeSuspended: false });
}
// The same rows as listSyncTargets, as counts (the start log line of the scopes).
export async function countSyncTargets(db: DbOrTrx): Promise<{ mailboxes: number; organizations: number }> {
  const targets = await listSyncTargets(db);
  return { mailboxes: targets.length, organizations: new Set(targets.map((target) => target.orgId)).size };
}
