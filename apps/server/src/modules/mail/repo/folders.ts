import {
  SYNC_FOLDER_DEFAULTS,
  syncFolderKeys,
  syncFolderRoles,
  type SyncFolderDefault,
  type SyncFolderKey,
  type SyncFolderRole,
} from "@ea/core";
import { sql, type Selectable, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, TenantContext } from "../../../platform/db";
import { HardError } from "../../../platform/errors";
import { INBOX } from "../port";

import type { DbOrTrx } from "./shared";

export interface Cursor {
  uidValidity: number | null;
  lastUid: number | null;
}
// Int8 columns compare as strings in Kysely `where`.
function toInt8(value: number | null): string | null {
  return value === null ? null : String(value);
}
const syncFolderKeySchema = z.enum(syncFolderKeys);
const syncFolderRoleSchema = z.enum(syncFolderRoles);
// The one row type of the table.
export interface SyncFolderRow {
  id: string;
  mailbox_id: string;
  key: SyncFolderKey;
  path: string;
  role: SyncFolderRole;
  enabled: boolean;
  uidvalidity: number | null;
  last_uid: number | null;
}
function toSyncFolderRow(row: Selectable<DB["mailbox_folders"]>): SyncFolderRow {
  const key = syncFolderKeySchema.safeParse(row.key);
  const role = syncFolderRoleSchema.safeParse(row.role);
  if (!key.success || !role.success) throw new HardError("mailbox_folders row has an unknown key or role");
  return {
    id: row.id,
    mailbox_id: row.mailbox_id,
    key: key.data,
    path: row.path,
    role: role.data,
    enabled: row.enabled,
    uidvalidity: row.uidvalidity === null ? null : Number(row.uidvalidity),
    last_uid: row.last_uid === null ? null : Number(row.last_uid),
  };
}
export async function insertInboxFolder(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<void> {
  await db
    .insertInto("mailbox_folders")
    .values({ org_id: ctx.orgId, mailbox_id: mailboxId, key: "inbox", path: INBOX, role: "inbox" })
    .onConflict((oc) => oc.columns(["mailbox_id", "key"]).doNothing())
    .execute();
}
export async function getSyncFolder(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  key: SyncFolderKey
): Promise<SyncFolderRow | undefined> {
  const row = await db
    .selectFrom("mailbox_folders")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("key", "=", key)
    .executeTakeFirst();
  return row && toSyncFolderRow(row);
}
export async function lockSyncFolder(
  trx: Transaction<DB>,
  ctx: TenantContext,
  folderId: string
): Promise<SyncFolderRow | undefined> {
  const row = await trx
    .selectFrom("mailbox_folders")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", folderId)
    .forUpdate()
    .executeTakeFirst();
  return row && toSyncFolderRow(row);
}
// Order: INBOX, then the sort rows in SYNC_FOLDER_DEFAULTS order, then junk.
export async function listSyncFolders(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { enabledOnly: boolean }
): Promise<SyncFolderRow[]> {
  const keyOrder = sql<number>`case key ${sql.join(
    SYNC_FOLDER_DEFAULTS.map((item, index) => sql`when ${sql.lit(item.key)} then ${sql.lit(index)}`),
    sql` `
  )} else ${sql.lit(SYNC_FOLDER_DEFAULTS.length)} end`;
  let query = db
    .selectFrom("mailbox_folders")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId);
  if (opts.enabledOnly) query = query.where("enabled", "=", true);
  const rows = await query
    .orderBy(sql`case role when 'inbox' then 0 when 'sort' then 1 else 2 end`)
    .orderBy(keyOrder)
    .orderBy("key")
    .execute();
  return rows.map(toSyncFolderRow);
}
// One INSERT that never changes an existing row (any unique key). Returns the rows that it inserted.
export async function insertSyncFolders(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  picks: readonly (SyncFolderDefault | { key: "inbox"; path: string; role: "inbox" })[],
  at: Date
): Promise<{ key: SyncFolderKey; role: SyncFolderRole }[]> {
  if (picks.length === 0) return [];
  const rows = await db
    .insertInto("mailbox_folders")
    .values(
      picks.map((pick) => ({
        org_id: ctx.orgId,
        mailbox_id: mailboxId,
        key: pick.key,
        path: pick.path,
        role: pick.role,
        created_at: at,
        updated_at: at,
      }))
    )
    .onConflict((oc) => oc.doNothing())
    .returning(["key", "role"])
    .execute();
  return rows.map((row) => {
    const key = syncFolderKeySchema.parse(row.key);
    const role = syncFolderRoleSchema.parse(row.role);
    return { key, role };
  });
}
export async function lockSyncFolderByKey(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  key: SyncFolderKey
): Promise<SyncFolderRow | undefined> {
  const row = await trx
    .selectFrom("mailbox_folders")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("key", "=", key)
    .forUpdate()
    .executeTakeFirst();
  return row && toSyncFolderRow(row);
}
// Sets `enabled`; with `clearCursor` the folder starts again with a new first sync.
export async function updateSyncFolderEnabled(
  trx: Transaction<DB>,
  ctx: TenantContext,
  folderId: string,
  change: { enabled: boolean; clearCursor: boolean; at: Date }
): Promise<boolean> {
  const row = await trx
    .updateTable("mailbox_folders")
    .set({
      enabled: change.enabled,
      updated_at: change.at,
      ...(change.clearCursor ? { uidvalidity: null, last_uid: null } : {}),
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", folderId)
    .returning("id")
    .executeTakeFirst();
  return row !== undefined;
}
// The path of the junk row, also when it is disabled.
export async function getJunkFolderPath(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<string | null> {
  const row = await db
    .selectFrom("mailbox_folders")
    .select("path")
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("role", "=", "junk")
    .executeTakeFirst();
  return row?.path ?? null;
}
// Conditional update on the folder row: it changes the cursor only when the stored cursor is still `expected`.
// The INBOX row also writes the two `mailboxes` columns in the same transaction (D3 dual write, for a code rollback).
export async function updateFolderCursor(
  db: DbOrTrx,
  ctx: TenantContext,
  folderId: string,
  expected: Cursor,
  next: Cursor
): Promise<boolean> {
  const run = async (trx: DbOrTrx): Promise<boolean> => {
    const row = await trx
      .updateTable("mailbox_folders")
      .set({ uidvalidity: next.uidValidity, last_uid: next.lastUid, updated_at: sql<Date>`now()` })
      .where("org_id", "=", ctx.orgId)
      .where("id", "=", folderId)
      .where("uidvalidity", "is not distinct from", toInt8(expected.uidValidity))
      .where("last_uid", "is not distinct from", toInt8(expected.lastUid))
      .returning(["mailbox_id", "key"])
      .executeTakeFirst();
    if (row === undefined) return false;
    if (row.key === "inbox") {
      await trx
        .updateTable("mailboxes")
        .set({ uidvalidity: next.uidValidity, last_uid: next.lastUid })
        .where("org_id", "=", ctx.orgId)
        .where("id", "=", row.mailbox_id)
        .execute();
    }
    return true;
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}
// The CAS of the INBOX row of the mailbox. False when the mailbox has no INBOX row.
export async function updateCursor(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  expected: Cursor,
  next: Cursor
): Promise<boolean> {
  const folder = await getSyncFolder(db, ctx, mailboxId, "inbox");
  if (folder === undefined) return false;
  return updateFolderCursor(db, ctx, folder.id, expected, next);
}
// Forces the next sync to rescan: a real server never has UIDVALIDITY 0, so the sync sees a change.
export async function forceRescan(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<boolean> {
  const run = async (trx: DbOrTrx): Promise<boolean> => {
    const result = await trx
      .updateTable("mailbox_folders")
      .set({ uidvalidity: "0", updated_at: sql<Date>`now()` })
      .where("org_id", "=", ctx.orgId)
      .where("mailbox_id", "=", mailboxId)
      .where("uidvalidity", "is not", null)
      .executeTakeFirst();
    // D3 dual write.
    await trx
      .updateTable("mailboxes")
      .set({ uidvalidity: "0" })
      .where("org_id", "=", ctx.orgId)
      .where("id", "=", mailboxId)
      .where("uidvalidity", "is not", null)
      .execute();
    return result.numUpdatedRows > 0n;
  };
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}
