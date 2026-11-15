import { sql, type Selectable, type Transaction } from "kysely";

import type { DB, TenantContext } from "../../../platform/db";
import { HardError } from "../../../platform/errors";

import type { DbOrTrx } from "./shared";

export type SentErrorCode = "no_folder" | "folder_missing" | "failed";
const SENT_ERROR_CODES: readonly string[] = ["no_folder", "folder_missing", "failed"] satisfies SentErrorCode[];

// The state of "Track my sent mail" for one mailbox. No row means off.
export interface SentSyncState {
  mailboxId: string;
  enabled: boolean;
  enabledAt: Date | null;
  path: string | null;
  uidValidity: number | null;
  lastUid: number | null;
  firstPassAt: Date | null;
  lastPassAt: Date | null;
  lastErrorCode: SentErrorCode | null;
}

function isSentErrorCode(value: string): value is SentErrorCode {
  return SENT_ERROR_CODES.includes(value);
}
function toNumber(value: string | null): number | null {
  return value === null ? null : Number(value);
}
function toSentSyncState(row: Selectable<DB["mailbox_sent_sync"]>): SentSyncState {
  if (row.last_error_code !== null && !isSentErrorCode(row.last_error_code)) {
    throw new HardError("mailbox_sent_sync row has an unknown error code");
  }
  return {
    mailboxId: row.mailbox_id,
    enabled: row.enabled,
    enabledAt: row.enabled_at,
    path: row.path,
    uidValidity: toNumber(row.uidvalidity),
    lastUid: toNumber(row.last_uid),
    firstPassAt: row.first_pass_at,
    lastPassAt: row.last_pass_at,
    lastErrorCode: row.last_error_code,
  };
}

export async function getSentSyncState(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<SentSyncState | undefined> {
  const row = await db
    .selectFrom("mailbox_sent_sync")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirst();
  return row && toSentSyncState(row);
}

// The same read with a row lock. The pass, the switch and the data-request erase take this lock first.
export async function lockSentSyncState(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string
): Promise<SentSyncState | undefined> {
  const row = await trx
    .selectFrom("mailbox_sent_sync")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .forUpdate()
    .executeTakeFirst();
  return row && toSentSyncState(row);
}

// A first row for a mailbox that has none. An existing row stays as it is. True when this call made the row.
export async function insertSentSyncState(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { enabled: boolean }
): Promise<boolean> {
  const result = await db
    .insertInto("mailbox_sent_sync")
    .values({
      org_id: ctx.orgId,
      mailbox_id: mailboxId,
      enabled: opts.enabled,
      enabled_at: opts.enabled ? sql<Date>`now()` : null,
    })
    .onConflict((oc) => oc.column("mailbox_id").doNothing())
    .executeTakeFirst();
  return (result.numInsertedOrUpdatedRows ?? 0n) > 0n;
}

// The owner's switch. On or off, the folder, the cursor and the pass fields start again: a new first pass follows.
export async function writeSentSwitch(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: { enabled: boolean; at?: Date }
): Promise<void> {
  const enabledAt = opts.enabled ? (opts.at ?? sql<Date>`now()`) : null;
  const cleared = {
    enabled: opts.enabled,
    enabled_at: enabledAt,
    path: null,
    uidvalidity: null,
    last_uid: null,
    first_pass_at: null,
    last_pass_at: null,
    last_error_code: null,
  };
  await trx
    .insertInto("mailbox_sent_sync")
    .values({ org_id: ctx.orgId, mailbox_id: mailboxId, ...cleared })
    .onConflict((oc) =>
      oc
        .column("mailbox_id")
        .doUpdateSet({ ...cleared, updated_at: sql`now()` })
        .where("mailbox_sent_sync.org_id", "=", ctx.orgId)
    )
    .execute();
}

// A new Sent folder path: the cursor and the first pass start again. Only an enabled row changes.
export async function resetSentCursor(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: { path: string }
): Promise<boolean> {
  const result = await trx
    .updateTable("mailbox_sent_sync")
    .set({ path: opts.path, uidvalidity: null, last_uid: null, first_pass_at: null, updated_at: sql`now()` })
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("enabled", "=", true)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// The cursor moves. `first_pass_at` is set once, when the first pass ends. Only an enabled row changes.
export async function updateSentCursor(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  cursor: { uidValidity: number; lastUid: number },
  opts?: { firstPassAt?: Date }
): Promise<boolean> {
  const firstPassAt = opts?.firstPassAt;
  const result = await trx
    .updateTable("mailbox_sent_sync")
    .set({
      uidvalidity: String(cursor.uidValidity),
      last_uid: String(cursor.lastUid),
      updated_at: sql`now()`,
      ...(firstPassAt === undefined ? {} : { first_pass_at: sql<Date>`coalesce(first_pass_at, ${firstPassAt})` }),
    })
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("enabled", "=", true)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// The end of a pass: its time and its error code (null for no error). Only an enabled row changes.
export async function markSentPass(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { at: Date; errorCode: SentErrorCode | null }
): Promise<boolean> {
  const result = await db
    .updateTable("mailbox_sent_sync")
    .set({ last_pass_at: opts.at, last_error_code: opts.errorCode, updated_at: sql`now()` })
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("enabled", "=", true)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}
