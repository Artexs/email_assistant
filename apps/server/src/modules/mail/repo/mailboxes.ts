import {
  authErrorReasons,
  mailboxStatuses,
  type FolderKey,
  type MailboxStatus as CoreMailboxStatus,
  type SmtpSecurity,
} from "@ea/core";
import { sql, type Selectable, type Transaction } from "kysely";
import { z } from "zod";

import type { DB, TenantContext } from "../../../platform/db";
import type { AuthErrorReason, MailCapabilities } from "../port";

import type { DbOrTrx } from "./shared";

export type MailboxRow = Omit<
  Selectable<DB["mailboxes"]>,
  | "uidvalidity"
  | "last_uid"
  | "capabilities"
  | "folder_map"
  | "smtp_security"
  | "send_via"
  | "oauth_provider"
  | "auth_reason"
> & {
  smtp_security: SmtpSecurity;
  /** `smtp` sends through the SMTP adapter, `graph` through Microsoft Graph. */
  send_via: "smtp" | "graph";
  /** Null for a password mailbox. */
  oauth_provider: "microsoft" | "google" | null;
  /** Why the OAuth login was refused; null for a password mailbox and for a mailbox that is not in `auth_error`. */
  auth_reason: AuthErrorReason | null;
  capabilities: MailCapabilities | Record<string, never>;
  folder_map: Record<string, string>;
};
function toAuthReason(value: string | null): AuthErrorReason | null {
  return authErrorReasons.find((reason) => reason === value) ?? null;
}
function toMailboxRow(row: Selectable<DB["mailboxes"]>): MailboxRow {
  return {
    ...row,
    smtp_security: row.smtp_security === "starttls" ? "starttls" : "tls",
    send_via: row.send_via === "graph" ? "graph" : "smtp",
    oauth_provider: row.oauth_provider === "microsoft" || row.oauth_provider === "google" ? row.oauth_provider : null,
    auth_reason: toAuthReason(row.auth_reason),
    capabilities: row.capabilities as MailCapabilities | Record<string, never>,
    folder_map: row.folder_map as Record<string, string>,
  };
}
export async function insertMailbox(
  db: DbOrTrx,
  ctx: TenantContext,
  input: {
    id: string;
    address: string;
    imapHost: string;
    imapPort: number;
    smtpHost: string;
    smtpPort: number;
    /** Left out: the column default `tls`. */
    smtpSecurity?: SmtpSecurity;
    /** Left out: the column default `smtp`. */
    sendVia?: "smtp" | "graph";
    /** Left out: NULL (a password mailbox). */
    oauthProvider?: "microsoft" | "google";
    capabilities: MailCapabilities;
    folderMap: Record<string, string>;
  }
): Promise<void> {
  await db
    .insertInto("mailboxes")
    .values({
      id: input.id,
      org_id: ctx.orgId,
      address: input.address,
      imap_host: input.imapHost,
      imap_port: input.imapPort,
      smtp_host: input.smtpHost,
      smtp_port: input.smtpPort,
      smtp_security: input.smtpSecurity,
      send_via: input.sendVia,
      oauth_provider: input.oauthProvider,
      capabilities: JSON.stringify(input.capabilities),
      folder_map: JSON.stringify(input.folderMap),
    })
    .execute();
}
export async function getMailbox(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<MailboxRow | undefined> {
  const row = await db
    .selectFrom("mailboxes")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .executeTakeFirst();
  return row && toMailboxRow(row);
}
export async function findMailboxIdByAddress(
  db: DbOrTrx,
  ctx: TenantContext,
  address: string
): Promise<string | undefined> {
  const row = await db
    .selectFrom("mailboxes")
    .select("id")
    .where("org_id", "=", ctx.orgId)
    .where(sql<string>`lower(address)`, "=", sql<string>`lower(${address})`)
    .executeTakeFirst();
  return row?.id;
}
// Every status counts: a paused or auth_error mailbox holds credentials and can be resumed.
export async function countMailboxesOfOrg(db: DbOrTrx, ctx: TenantContext): Promise<number> {
  const row = await db
    .selectFrom("mailboxes")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("org_id", "=", ctx.orgId)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}
// Serializes the connects of one organization until the transaction ends. It needs a transaction:
// outside one, the lock ends with its own statement.
export async function lockMailboxLimit(db: DbOrTrx, ctx: TenantContext): Promise<void> {
  if (!db.isTransaction) throw new Error("lockMailboxLimit needs a transaction");
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mailbox_limit:${ctx.orgId}`}, 0))`.execute(db);
}
export async function lockMailbox(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string
): Promise<MailboxRow | undefined> {
  const row = await trx
    .selectFrom("mailboxes")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .forUpdate()
    .executeTakeFirst();
  return row && toMailboxRow(row);
}
export async function markSynced(db: DbOrTrx, ctx: TenantContext, mailboxId: string, at: Date): Promise<void> {
  await db
    .updateTable("mailboxes")
    .set({ last_synced_at: at })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .execute();
}
export type MailboxStatus = CoreMailboxStatus;
export const mailboxStatusSchema = z.enum(mailboxStatuses);
// The update is unconditional (an `auth_error` from the sync job wins over a pause). `status_changed_at` moves only when the status really changes.
// `auth_reason` is written in the same statement (the table CHECK allows a reason only in `auth_error` on an `oauth` mailbox): `reason`
// counts only for `auth_error`; every other status clears it. A password mailbox keeps NULL, so a reason for it never reaches the CHECK.
export async function setMailboxStatus(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  status: MailboxStatus,
  at?: Date,
  reason?: AuthErrorReason | null
): Promise<void> {
  const authReason = status === "auth_error" ? (reason ?? null) : null;
  await db
    .updateTable("mailboxes")
    .set({
      status,
      status_changed_at: sql<Date>`CASE WHEN status IS DISTINCT FROM ${status} THEN ${at ?? sql`now()`} ELSE status_changed_at END`,
      auth_reason: sql<string | null>`CASE WHEN oauth_provider IS NOT NULL THEN ${authReason}::text ELSE NULL END`,
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .execute();
}
// The end of a Reconnect: the status and, in the same statement, the reason (the table CHECK allows a reason only in `auth_error`).
// `status_changed_at` moves only when the status really changes.
export async function finishMailboxReconnect(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  change: { status: MailboxStatus; at: Date }
): Promise<void> {
  await db
    .updateTable("mailboxes")
    .set({
      status: change.status,
      status_changed_at: sql<Date>`CASE WHEN status IS DISTINCT FROM ${change.status} THEN ${change.at} ELSE status_changed_at END`,
      auth_reason: null,
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .execute();
}
// Conditional update: it changes the row only while the status is still `change.from`.
// With `seenChangedAt` it also needs the episode the caller read: a newer change of the same status stops the write.
// The compare is at millisecond precision, the precision of a JS Date.
export async function changeMailboxStatus(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  change: { from: MailboxStatus; to: MailboxStatus; at: Date; seenChangedAt?: Date }
): Promise<boolean> {
  let query = db
    .updateTable("mailboxes")
    // `auth_reason` goes with the status (the table CHECK): none of the targets is `auth_error` with a reason.
    .set({ status: change.to, status_changed_at: change.at, auth_reason: null })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .where("status", "=", change.from);
  if (change.seenChangedAt !== undefined) {
    query = query.where(sql<boolean>`date_trunc('milliseconds', status_changed_at) = ${change.seenChangedAt}`);
  }
  const result = await query.executeTakeFirst();
  return result.numUpdatedRows === 1n;
}
export interface MailboxSummary {
  id: string;
  address: string;
  status: MailboxStatus;
  last_synced_at: Date | null;
  status_changed_at: Date;
  created_at: Date;
  /** Null for a password mailbox. */
  oauth_provider: "microsoft" | "google" | null;
  /** Why the OAuth login was refused; null for a password mailbox and outside `auth_error`. */
  auth_reason: AuthErrorReason | null;
}
const summaryColumns = [
  "id",
  "address",
  "status",
  "last_synced_at",
  "status_changed_at",
  "created_at",
  "oauth_provider",
  "auth_reason",
] as const;
function toSummary(row: Pick<Selectable<DB["mailboxes"]>, (typeof summaryColumns)[number]>): MailboxSummary {
  return {
    ...row,
    status: mailboxStatusSchema.parse(row.status),
    oauth_provider: row.oauth_provider === "microsoft" || row.oauth_provider === "google" ? row.oauth_provider : null,
    auth_reason: toAuthReason(row.auth_reason),
  };
}
export async function getMailboxSummary(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<MailboxSummary | undefined> {
  const row = await db
    .selectFrom("mailboxes")
    .select(summaryColumns)
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .executeTakeFirst();
  return row && toSummary(row);
}
export async function listMailboxes(db: DbOrTrx, ctx: TenantContext): Promise<MailboxSummary[]> {
  const rows = await db
    .selectFrom("mailboxes")
    .select(summaryColumns)
    .where("org_id", "=", ctx.orgId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map(toSummary);
}
// The status and the last sync of every mailbox of every organization, for the operator list (no address, no secret).
export async function listMailboxStatesOfAll(
  db: DbOrTrx
): Promise<{ orgId: string; status: string; lastSyncedAt: Date | null }[]> {
  const rows = await db.selectFrom("mailboxes").select(["org_id", "status", "last_synced_at"]).execute();
  return rows.map((row) => ({ orgId: row.org_id, status: row.status, lastSyncedAt: row.last_synced_at }));
}
// The draft removal needs UIDPLUS. An unknown mailbox counts as no UIDPLUS.
export async function mailboxHasUidplus(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<boolean> {
  const mailbox = await getMailbox(db, ctx, mailboxId);
  return (mailbox?.capabilities as Partial<MailCapabilities> | undefined)?.uidplus === true;
}
// Replaces one key of `mailboxes.folder_map` and keeps the others.
export async function setFolderMapEntry(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  key: FolderKey | "drafts" | "sent",
  path: string
): Promise<boolean> {
  const result = await db
    .updateTable("mailboxes")
    .set({ folder_map: sql`jsonb_set(folder_map, ARRAY[${key}]::text[], to_jsonb(${path}::text), true)` })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}
