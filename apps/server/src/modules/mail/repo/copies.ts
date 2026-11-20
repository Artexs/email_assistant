import type { TenantContext } from "../../../platform/db";
import { otherCopyUids, type KnownCopy } from "../sync-rules";

import type { DbOrTrx } from "./shared";

export async function findCopies(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  key: { messageId: string | null; contentHash: string }
): Promise<KnownCopy[]> {
  const rows = await db
    .selectFrom("emails")
    .select([
      "id",
      "dedup_key",
      "folder",
      "source_folder",
      "uid",
      "content_hash",
      "from_address",
      "received_at",
      "move_pending_at",
    ])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("message_id_header", key.messageId === null ? "is" : "=", key.messageId)
    .where("content_hash", "=", key.contentHash)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    dedupKey: row.dedup_key,
    folder: row.folder,
    sourceFolder: row.source_folder,
    uid: Number(row.uid),
    contentHash: row.content_hash,
    from: row.from_address,
    receivedAt: row.received_at,
    movePendingAt: row.move_pending_at,
  }));
}
// The UIDs that the other rows of the same identity hold in `folder` (the `excludeUids` of locateMessage).
export async function listFolderUids(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  folder: string,
  key: { exceptEmailId: string; messageId: string | null; contentHash: string }
): Promise<Set<number>> {
  const copies = await findCopies(db, ctx, mailboxId, key);
  return otherCopyUids(copies, key.exceptEmailId, folder);
}
export interface MovedRow {
  id: string;
  /** The UID in `folder` (the hint of the folder check). */
  uid: number;
  /** The last known UID in `source_folder` (the name stays). */
  source_uid: number | null;
  folder: string;
  source_folder: string;
  message_id_header: string | null;
  content_hash: string;
  from_address: string | null;
  received_at: Date;
  moved_at: Date;
}
// Mail that the system moved out of `sourceFolder` lately: the candidates for a return below that folder's UID cursor.
export async function listRecentlyMoved(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  opts: { sourceFolder: string; movedAfter: Date; limit: number }
): Promise<MovedRow[]> {
  const rows = await db
    .selectFrom("emails")
    .select([
      "id",
      "uid",
      "source_uid",
      "folder",
      "source_folder",
      "message_id_header",
      "content_hash",
      "from_address",
      "received_at",
      "moved_at",
    ])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("source_folder", "=", opts.sourceFolder)
    .whereRef("folder", "<>", "source_folder")
    .where("source_uid", "is not", null)
    .where("moved_at", ">=", opts.movedAfter)
    .orderBy("moved_at", "desc")
    .orderBy("id")
    .limit(opts.limit)
    .execute();
  return rows.flatMap((row) =>
    row.moved_at === null
      ? []
      : [
          {
            ...row,
            uid: Number(row.uid),
            source_uid: row.source_uid === null ? null : Number(row.source_uid),
            moved_at: row.moved_at,
          },
        ]
  );
}

/** A stored row whose mail the flag refresh did not find in its folder: a candidate of the move finder. */
export interface MoveCandidateRow {
  id: string;
  folder: string;
  source_folder: string;
  /** The UID in `folder`. */
  uid: number;
  message_id_header: string | null;
  content_hash: string;
  from_address: string | null;
  received_at: Date;
  /** emails.move_pending_at: a system move into a synced folder is in flight. */
  move_pending_at: Date | null;
}

const MOVE_CANDIDATE_CHUNK = 500;

// The rows of `emailIds` in the mailbox, in no fixed order; unknown ids are left out. [] for an empty list (no query).
export async function listMoveCandidates(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  emailIds: readonly string[]
): Promise<MoveCandidateRow[]> {
  const result: MoveCandidateRow[] = [];
  for (let start = 0; start < emailIds.length; start += MOVE_CANDIDATE_CHUNK) {
    const chunk = emailIds.slice(start, start + MOVE_CANDIDATE_CHUNK);
    const rows = await db
      .selectFrom("emails")
      .select([
        "id",
        "folder",
        "source_folder",
        "uid",
        "message_id_header",
        "content_hash",
        "from_address",
        "received_at",
        "move_pending_at",
      ])
      .where("org_id", "=", ctx.orgId)
      .where("mailbox_id", "=", mailboxId)
      .where("id", "in", chunk)
      .execute();
    for (const row of rows) result.push({ ...row, uid: Number(row.uid) });
  }
  return result;
}

/** A stored row at a UID of one folder: the identity fields the caller compares. */
export interface FolderRowAtUid {
  id: string;
  uid: number;
  message_id_header: string | null;
  content_hash: string;
  from_address: string | null;
  received_at: Date;
}

// The rows that hold one of `uids` in `folder`, of any identity (the caller compares). [] for an empty list (no query).
export async function listFolderRowsAtUids(
  db: DbOrTrx,
  ctx: TenantContext,
  mailboxId: string,
  folder: string,
  uids: readonly number[]
): Promise<FolderRowAtUid[]> {
  if (uids.length === 0) return [];
  const rows = await db
    .selectFrom("emails")
    .select(["id", "uid", "message_id_header", "content_hash", "from_address", "received_at"])
    .where("org_id", "=", ctx.orgId)
    .where("mailbox_id", "=", mailboxId)
    .where("folder", "=", folder)
    .where("uid", "in", uids.map(String))
    .execute();
  return rows.map((row) => ({ ...row, uid: Number(row.uid) }));
}
