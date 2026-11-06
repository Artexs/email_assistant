import {
  expressionBuilder,
  sql,
  type Expression,
  type Insertable,
  type Selectable,
  type SqlBool,
  type Transaction,
} from "kysely";
import { z } from "zod";

import type { DB, Db, TenantContext } from "../../platform/db";

import type { MailCapabilities } from "./port";
import { SYNTHETIC_MESSAGE_ID_LIKE } from "./seed";
import type { KnownCopy } from "./sync-rules";

type DbOrTrx = Db | Transaction<DB>;

export type MailKind = "real" | "synthetic";

// Filter on `emails.message_id_header`: real mail is every row without a synthetic Message-ID (also NULL).
export function mailKindFilter(kind: MailKind): Expression<SqlBool> {
  const eb = expressionBuilder<DB, "emails">();
  if (kind === "synthetic") return eb("emails.message_id_header", "ilike", SYNTHETIC_MESSAGE_ID_LIKE);
  return eb.or([
    eb("emails.message_id_header", "is", null),
    eb("emails.message_id_header", "not ilike", SYNTHETIC_MESSAGE_ID_LIKE),
  ]);
}

export interface Cursor {
  uidValidity: number | null;
  lastUid: number | null;
}

export type MailboxRow = Omit<
  Selectable<DB["mailboxes"]>,
  "uidvalidity" | "last_uid" | "capabilities" | "folder_map"
> & {
  uidvalidity: number | null;
  last_uid: number | null;
  capabilities: MailCapabilities | Record<string, never>;
  folder_map: Record<string, string>;
};

export type NewEmail = Omit<Insertable<DB["emails"]>, "id" | "org_id" | "status" | "attempts" | "created_at">;

export interface ClaimedEmail {
  id: string;
  mailbox_id: string;
  locked_at: Date;
  attempts: number;
  next_attempt_at: Date | null;
  backfilled_at: Date | null;
  received_at: Date;
  from_address: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string | null;
  body_text: string | null;
  thread_key: string;
  message_id_header: string | null;
}

// Int8 columns compare as strings in Kysely `where`.
function toInt8(value: number | null): string | null {
  return value === null ? null : String(value);
}

function toMailboxRow(row: Selectable<DB["mailboxes"]>): MailboxRow {
  return {
    ...row,
    uidvalidity: row.uidvalidity === null ? null : Number(row.uidvalidity),
    last_uid: row.last_uid === null ? null : Number(row.last_uid),
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

// Conditional update: it changes the cursor only when the stored cursor is still `expected`.
export async function updateCursor(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  expected: Cursor,
  next: Cursor
): Promise<boolean> {
  const result = await db
    .updateTable("mailboxes")
    .set({ uidvalidity: next.uidValidity, last_uid: next.lastUid })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .where("uidvalidity", "is not distinct from", toInt8(expected.uidValidity))
    .where("last_uid", "is not distinct from", toInt8(expected.lastUid))
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

export async function markSynced(db: DbOrTrx, ctx: TenantContext, mailboxId: string, at: Date): Promise<void> {
  await db
    .updateTable("mailboxes")
    .set({ last_synced_at: at })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .execute();
}

export type MailboxStatus = "active" | "auth_error" | "paused";

const mailboxStatusSchema = z.enum(["active", "auth_error", "paused"]);

// The update is unconditional (an `auth_error` from the sync job wins over a pause). `status_changed_at` moves only when the status really changes.
export async function setMailboxStatus(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  status: MailboxStatus,
  at?: Date
): Promise<void> {
  await db
    .updateTable("mailboxes")
    .set({
      status,
      status_changed_at: sql<Date>`CASE WHEN status IS DISTINCT FROM ${status} THEN ${at ?? sql`now()`} ELSE status_changed_at END`,
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .execute();
}

// Conditional update: it changes the row only while the status is still `change.from`.
export async function changeMailboxStatus(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  change: { from: "active" | "paused"; to: "active" | "paused"; at: Date }
): Promise<boolean> {
  const result = await db
    .updateTable("mailboxes")
    .set({ status: change.to, status_changed_at: change.at })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .where("status", "=", change.from)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

export interface MailboxSummary {
  id: string;
  address: string;
  status: MailboxStatus;
  last_synced_at: Date | null;
  status_changed_at: Date;
  created_at: Date;
}

export async function listMailboxes(db: DbOrTrx, ctx: TenantContext): Promise<MailboxSummary[]> {
  const rows = await db
    .selectFrom("mailboxes")
    .select(["id", "address", "status", "last_synced_at", "status_changed_at", "created_at"])
    .where("org_id", "=", ctx.orgId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({ ...row, status: mailboxStatusSchema.parse(row.status) }));
}

// Mail that waits for triage in all mailboxes of the org.
export async function countWaiting(db: DbOrTrx, ctx: TenantContext, opts: { receivedSince: Date }): Promise<number> {
  const row = await db
    .selectFrom("emails")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("org_id", "=", ctx.orgId)
    .where("status", "in", ["pending", "processing"])
    .where("received_at", ">=", opts.receivedSince)
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

export async function insertCredentials(
  db: DbOrTrx,
  ctx: TenantContext,
  input: { mailboxId: string; encryptedSecret: string; secretKind: "password" | "app_password"; keyVersion: number }
): Promise<void> {
  await db
    .insertInto("mailbox_credentials")
    .values({
      mailbox_id: input.mailboxId,
      org_id: ctx.orgId,
      encrypted_secret: input.encryptedSecret,
      secret_kind: input.secretKind,
      key_version: input.keyVersion,
    })
    .execute();
}

// Replaces the stored secret of a mailbox. False when the credentials row is missing.
export async function updateCredentials(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  row: { encryptedSecret: string; secretKind: "password" | "app_password"; keyVersion: number }
): Promise<boolean> {
  const result = await db
    .updateTable("mailbox_credentials")
    .set({ encrypted_secret: row.encryptedSecret, secret_kind: row.secretKind, key_version: row.keyVersion })
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

export async function getCredentials(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string
): Promise<{ encrypted_secret: string; secret_kind: string; key_version: number } | undefined> {
  return db
    .selectFrom("mailbox_credentials")
    .select(["encrypted_secret", "secret_kind", "key_version"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .executeTakeFirst();
}

export async function findCopies(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  key: { messageId: string | null; contentHash: string }
): Promise<KnownCopy[]> {
  const rows = await db
    .selectFrom("emails")
    .select(["id", "dedup_key", "folder"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("message_id_header", key.messageId === null ? "is" : "=", key.messageId)
    .where("content_hash", "=", key.contentHash)
    .execute();
  return rows.map((row) => ({ id: row.id, dedupKey: row.dedup_key, folder: row.folder }));
}

export async function insertEmail(db: DbOrTrx, ctx: TenantContext, row: NewEmail): Promise<boolean> {
  const result = await db
    .insertInto("emails")
    .values({ ...row, org_id: ctx.orgId })
    .onConflict((oc) => oc.columns(["mailbox_id", "dedup_key"]).doNothing())
    .executeTakeFirst();
  return (result.numInsertedOrUpdatedRows ?? 0n) > 0n;
}

export async function updateEmailUid(db: DbOrTrx, ctx: TenantContext, emailId: string, uid: number): Promise<void> {
  await db.updateTable("emails").set({ uid }).where("org_id", "=", ctx.orgId).where("id", "=", emailId).execute();
}

export async function markEmailReturned(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  uid: number,
  at: Date
): Promise<void> {
  await db
    .updateTable("emails")
    .set({ returned_at: at, folder: "INBOX", uid })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .execute();
}

// Scheduler entry point: lists work across tenants, so it takes no TenantContext. Callers build a TenantContext from orgId for every later call.
export async function listSyncTargets(db: DbOrTrx): Promise<{ orgId: string; mailboxId: string }[]> {
  const rows = await db
    .selectFrom("mailboxes")
    .select(["org_id", "id"])
    .where("status", "=", "active")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return rows.map((row) => ({ orgId: row.org_id, mailboxId: row.id }));
}

// Forces the next sync to rescan: a real server never has UIDVALIDITY 0, so the sync sees a change.
export async function forceRescan(db: DbOrTrx, ctx: TenantContext, mailboxId: string): Promise<boolean> {
  const result = await db
    .updateTable("mailboxes")
    .set({ uidvalidity: "0" })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", mailboxId)
    .where("uidvalidity", "is not", null)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// Claims due pending rows and stale processing rows. `locked_at` = `opts.now` (a JS value, not SQL now()):
// it is the token for releaseEmail and finishEmail, so it must survive the round trip exactly.
// Taking back a stale processing row counts an attempt (the earlier run may have died on this mail), so `attempts` in
// the result is the new value.
export async function claimEmails(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { now: Date; limit: number; staleBefore: Date; syntheticOnly: boolean }
): Promise<ClaimedEmail[]> {
  const rows = await db
    .with("picked", (qb) => {
      let query = qb
        .selectFrom("emails")
        .select("id")
        .where("org_id", "=", ctx.orgId)
        .where("mailbox_id", "=", mailboxId)
        .where((eb) =>
          eb.or([
            eb.and([
              eb("status", "=", "pending"),
              eb.or([eb("next_attempt_at", "is", null), eb("next_attempt_at", "<=", opts.now)]),
            ]),
            eb.and([eb("status", "=", "processing"), eb("locked_at", "<", opts.staleBefore)]),
          ])
        );
      if (opts.syntheticOnly) query = query.where(mailKindFilter("synthetic"));
      return query.orderBy("received_at").orderBy("id").limit(opts.limit).forUpdate().skipLocked();
    })
    .updateTable("emails as e")
    .set((eb) => ({
      status: "processing",
      locked_at: opts.now,
      attempts: eb
        .case()
        .when("e.status", "=", "processing")
        .then(eb("e.attempts", "+", 1))
        .else(eb.ref("e.attempts"))
        .end(),
    }))
    .from("picked")
    .whereRef("e.id", "=", "picked.id")
    .where("e.org_id", "=", ctx.orgId)
    .returning([
      "e.id",
      "e.mailbox_id",
      "e.locked_at",
      "e.attempts",
      "e.next_attempt_at",
      "e.backfilled_at",
      "e.received_at",
      "e.from_address",
      "e.to_addresses",
      "e.cc_addresses",
      "e.subject",
      "e.body_text",
      "e.thread_key",
      "e.message_id_header",
    ])
    .execute();
  // RETURNING has no order.
  return rows
    .map((row) => ({ ...row, locked_at: row.locked_at ?? opts.now }))
    .sort((x, y) => x.received_at.getTime() - y.received_at.getTime() || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

// Conditional update: it changes the row only while the claim with `lockedAt` still holds it.
export async function releaseEmail(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  lockedAt: Date,
  opts: { nextAttemptAt: Date | null; countAttempt: boolean }
): Promise<boolean> {
  const result = await db
    .updateTable("emails")
    .set((eb) => ({
      status: "pending",
      locked_at: null,
      next_attempt_at: opts.nextAttemptAt,
      attempts: opts.countAttempt ? eb("attempts", "+", 1) : eb.ref("attempts"),
    }))
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .where("status", "=", "processing")
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

// Conditional update with the same guard as releaseEmail.
export async function finishEmail(
  trx: Transaction<DB>,
  ctx: TenantContext,
  emailId: string,
  lockedAt: Date,
  next: { status: "triaged" } | { status: "skipped"; skipReason: "too_old" }
): Promise<boolean> {
  const result = await trx
    .updateTable("emails")
    .set({
      status: next.status,
      skip_reason: next.status === "skipped" ? next.skipReason : null,
      locked_at: null,
      next_attempt_at: null,
    })
    .where("org_id", "=", ctx.orgId)
    .where("id", "=", emailId)
    .where("status", "=", "processing")
    .where("locked_at", "=", lockedAt)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

export async function listThreadContext(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  threadKey: string,
  before: Date,
  excludeId: string,
  opts: { syntheticOnly: boolean }
): Promise<{ from_address: string | null; subject: string | null; received_at: Date; body_excerpt: string | null }[]> {
  let query = db
    .selectFrom("emails")
    .select(["from_address", "subject", "received_at", sql<string | null>`left(body_text, 500)`.as("body_excerpt")])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("thread_key", "=", threadKey)
    .where("received_at", "<", before)
    .where("id", "!=", excludeId);
  if (opts.syntheticOnly) query = query.where(mailKindFilter("synthetic"));
  return query.orderBy("received_at", "desc").orderBy("id", "desc").limit(3).execute();
}

export async function listInboxEmailKeys(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  since: Date
): Promise<{ message_id_header: string | null; content_hash: string }[]> {
  return db
    .selectFrom("emails")
    .select(["message_id_header", "content_hash"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("folder", "=", "INBOX")
    .where("received_at", ">=", since)
    .execute();
}

// Gives stored real INBOX mail of the window that the worker skipped as `too_old` a new triage run. No audit: the caller writes it.
export async function requeueTooOld(
  trx: Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date; now: Date }
): Promise<string[]> {
  const rows = await trx
    .updateTable("emails")
    .set({ status: "pending", skip_reason: null, next_attempt_at: null, backfilled_at: opts.now })
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("folder", "=", "INBOX")
    .where("status", "=", "skipped")
    .where("skip_reason", "=", "too_old")
    .where("received_at", ">=", opts.since)
    .where(mailKindFilter("real"))
    .returning("id")
    .execute();
  return rows.map((row) => row.id);
}
