import { sql } from "kysely";

import type { TenantContext } from "../../../platform/db";

import type { DbOrTrx } from "./shared";

const WRITE_CHUNK = 500;

export interface FlagTarget {
  emailId: string;
  /** `emails.folder` (the path). */
  folder: string;
  /** `emails.uid`. */
  uid: number;
  /** `emails.message_id_header`. */
  messageId: string | null;
  /** `emails.received_at` (the INTERNALDATE of the first read). */
  receivedAt: Date;
}

// Mail of the mailbox received at or after `since`: never checked first, then the oldest `checked_at`, then the newest mail.
export async function listFlagTargets(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date; limit: number }
): Promise<FlagTarget[]> {
  const rows = await db
    .selectFrom("emails as e")
    .leftJoin("email_flags as f", "f.email_id", "e.id")
    .select(["e.id", "e.folder", "e.uid", "e.message_id_header", "e.received_at"])
    .where("e.org_id", "=", ctx.orgId)
    .where("e.mailbox_id", "=", mailboxId)
    .where("e.received_at", ">=", opts.since)
    .orderBy(sql`f.checked_at NULLS FIRST`)
    .orderBy("e.received_at", "desc")
    .orderBy("e.id")
    .limit(opts.limit)
    .execute();
  return rows.map((row) => ({
    emailId: row.id,
    folder: row.folder,
    uid: Number(row.uid),
    messageId: row.message_id_header,
    receivedAt: row.received_at,
  }));
}

export interface FlagRead extends FlagTarget {
  seen: boolean;
  answered: boolean;
  flagged: boolean;
}

// D6: one row per mail, written only while `emails.folder` and `emails.uid` still equal the read's (a move in between skips
// the mail). The first-seen times never reset. The answered check columns are not touched. Returns the rows written.
export async function writeEmailFlags(db: DbOrTrx, ctx: TenantContext, reads: FlagRead[], at: Date): Promise<number> {
  // One statement cannot change a row twice: the last read of a mail wins.
  const latest = [...new Map(reads.map((read) => [read.emailId, read])).values()];
  let written = 0;
  for (let from = 0; from < latest.length; from += WRITE_CHUNK) {
    const rows = latest
      .slice(from, from + WRITE_CHUNK)
      .map(
        (r) =>
          sql`(${r.emailId}::uuid, ${r.folder}::text, ${r.uid}::bigint, ${r.seen}::boolean, ${r.answered}::boolean, ${r.flagged}::boolean)`
      );
    const result = await sql`
      INSERT INTO email_flags (
        email_id, org_id, seen, answered, flagged, first_seen_at, first_answered_at, first_flagged_at, checked_at
      )
      SELECT
        e.id, e.org_id, r.seen, r.answered, r.flagged,
        CASE WHEN r.seen THEN ${at}::timestamptz END,
        CASE WHEN r.answered THEN ${at}::timestamptz END,
        CASE WHEN r.flagged THEN ${at}::timestamptz END,
        ${at}::timestamptz
      FROM emails e
      JOIN (VALUES ${sql.join(rows)}) AS r(email_id, folder, uid, seen, answered, flagged)
        ON e.id = r.email_id AND e.folder = r.folder AND e.uid = r.uid
      WHERE e.org_id = ${ctx.orgId}
      ON CONFLICT (email_id) DO UPDATE SET
        seen = excluded.seen,
        answered = excluded.answered,
        flagged = excluded.flagged,
        first_seen_at = COALESCE(email_flags.first_seen_at, excluded.first_seen_at),
        first_answered_at = COALESCE(email_flags.first_answered_at, excluded.first_answered_at),
        first_flagged_at = COALESCE(email_flags.first_flagged_at, excluded.first_flagged_at),
        checked_at = excluded.checked_at
    `.execute(db);
    written += Number(result.numAffectedRows ?? 0n);
  }
  return written;
}

// N1 (review 1): mail that a refresh could not read (gone, moved, or a UID of another mail) must not stay at the head of the
// queue. This sets `checked_at` ("last tried") only, under the same folder and UID guard as `writeEmailFlags`. A mail without
// a row gets one with all flags false and no first-seen time: that row means "tried, flags unknown", never "unread".
// The flags, the first_*_at times and the answered check of an existing row are not touched.
export async function touchEmailFlags(
  db: DbOrTrx,
  ctx: TenantContext,
  targets: FlagTarget[],
  at: Date
): Promise<number> {
  const latest = [...new Map(targets.map((target) => [target.emailId, target])).values()];
  let touched = 0;
  for (let from = 0; from < latest.length; from += WRITE_CHUNK) {
    const rows = latest
      .slice(from, from + WRITE_CHUNK)
      .map((t) => sql`(${t.emailId}::uuid, ${t.folder}::text, ${t.uid}::bigint)`);
    const result = await sql`
      INSERT INTO email_flags (email_id, org_id, seen, answered, flagged, checked_at)
      SELECT e.id, e.org_id, false, false, false, ${at}::timestamptz
      FROM emails e
      JOIN (VALUES ${sql.join(rows)}) AS r(email_id, folder, uid)
        ON e.id = r.email_id AND e.folder = r.folder AND e.uid = r.uid
      WHERE e.org_id = ${ctx.orgId}
      ON CONFLICT (email_id) DO UPDATE SET checked_at = excluded.checked_at
    `.execute(db);
    touched += Number(result.numAffectedRows ?? 0n);
  }
  return touched;
}

// The answer of the answered check (`/review`). The first answer wins: it writes only while `answered_check` is null.
// It also needs `answered`: only a real flag read sets that column, and a "last tried" row (`touchEmailFlags`) has it false.
// Returns true when it wrote.
export async function setAnsweredCheck(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string,
  input: { answer: "yes" | "no"; userId: string; at: Date }
): Promise<boolean> {
  const result = await db
    .updateTable("email_flags")
    .set({ answered_check: input.answer, answered_check_at: input.at, answered_check_by: input.userId })
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .where("answered", "=", true)
    .where("answered_check", "is", null)
    .executeTakeFirst();
  return result.numUpdatedRows === 1n;
}

export interface EmailFlagsRow {
  emailId: string;
  seen: boolean;
  answered: boolean;
  flagged: boolean;
  firstSeenAt: Date | null;
  firstAnsweredAt: Date | null;
  firstFlaggedAt: Date | null;
  checkedAt: Date;
  answeredCheck: "yes" | "no" | null;
}

export async function getEmailFlags(
  db: DbOrTrx,
  ctx: TenantContext,
  emailId: string
): Promise<EmailFlagsRow | undefined> {
  const row = await db
    .selectFrom("email_flags")
    .selectAll()
    .where("org_id", "=", ctx.orgId)
    .where("email_id", "=", emailId)
    .executeTakeFirst();
  if (row === undefined) return undefined;
  return {
    emailId: row.email_id,
    seen: row.seen,
    answered: row.answered,
    flagged: row.flagged,
    firstSeenAt: row.first_seen_at,
    firstAnsweredAt: row.first_answered_at,
    firstFlaggedAt: row.first_flagged_at,
    checkedAt: row.checked_at,
    answeredCheck: row.answered_check === "yes" || row.answered_check === "no" ? row.answered_check : null,
  };
}
