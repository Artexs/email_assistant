import { mailboxModes, mailboxScopeBadges, z, type MailboxView, type ScopeEnv } from "@ea/core";

import type { Db, TenantContext } from "../../platform/db";
import { getMailboxSettings, getMovesSupported } from "../config";

import { getCredentials, getMailboxSummary, listMailboxes, type MailboxSummary } from "./repo";

const modeSchema = z.enum(mailboxModes);

async function viewOf(db: Db, ctx: TenantContext, row: MailboxSummary, env: ScopeEnv): Promise<MailboxView> {
  const settings = await getMailboxSettings(db, ctx, row.id);
  const movesSupported = await getMovesSupported(db, ctx, row.id);
  const credentials = await getCredentials(db, ctx, row.id);
  return {
    id: row.id,
    address: row.address,
    status: row.status,
    statusChangedAt: row.status_changed_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
    mode: settings ? modeSchema.parse(settings.mode) : null,
    movesSupported,
    secretKind: credentials?.secret_kind === "app_password" ? "app_password" : "password",
    scopes: mailboxScopeBadges(env, row.address),
  };
}

// An organization has a few mailboxes: the per-row reads are fine (no N+1 concern at this size).
export async function listMailboxViews(db: Db, ctx: TenantContext, env: ScopeEnv): Promise<MailboxView[]> {
  const rows = await listMailboxes(db, ctx);
  const views: MailboxView[] = [];
  for (const row of rows) views.push(await viewOf(db, ctx, row, env));
  return views;
}

export async function getMailboxView(
  db: Db,
  ctx: TenantContext,
  mailboxId: string,
  env: ScopeEnv
): Promise<MailboxView | undefined> {
  const row = await getMailboxSummary(db, ctx, mailboxId);
  return row && viewOf(db, ctx, row, env);
}
