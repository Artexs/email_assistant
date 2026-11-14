import type { SyncFolderKey } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";

import type { FolderMessageMeta, MailProvider } from "./port";
import {
  listFolderUids,
  listMoveCandidates,
  listSyncFolders,
  lockSyncFolder,
  markEmailRelocated,
  markEmailReturned,
  type FlagTarget,
  type MoveCandidateRow,
  type SyncFolderRow,
} from "./repo";
import { CursorMovedError } from "./sync";
import { matchMoved, MOVE_PENDING_MAX_AGE_MS } from "./sync-rules";

// Interia keeps the UID of a mail when the user moves it in webmail. The flag refresh reports the mail that is gone
// from its stored folder; this finder looks for each of them at the same UID in the synced folders below their cursors
// (the normal sync pass of a folder never reads a UID below its cursor). A hit with the same identity gives the row its
// new location: `returned` when the system had moved the mail, `relocated` when it had not. Nothing here writes to the
// mailbox, and no line names a path, address, subject or Message-ID.

const log = createLog("mail");

/** UIDs per `fetchByUidsIn` call of the finder (one UID FETCH per call). */
export const MOVE_CHECK_CHUNK = 500;

export interface UserMovesDeps {
  db: Db | Transaction<DB>;
  provider: MailProvider;
  now(): Date;
  /** UIDs per fetch; default `MOVE_CHECK_CHUNK`. A test sets it small. */
  chunkSize?: number;
}

export interface UserMovesResult {
  /** Gone rows that still have the folder and UID of the read and no fresh move marker. */
  checked: number;
  returned: number;
  relocated: number;
  /** Hits not written because the folder cursor moved; the next refresh looks again. */
  retry: number;
}

interface Hit {
  row: MoveCandidateRow;
  uid: number;
  kind: "returned" | "relocated";
}

// The rows that the DB still holds where the refresh read them, without a system move in flight.
function stillGone(rows: readonly MoveCandidateRow[], gone: readonly FlagTarget[], now: Date): MoveCandidateRow[] {
  return rows.filter((row) => {
    if (!gone.some((target) => target.emailId === row.id && target.folder === row.folder && target.uid === row.uid)) {
      return false;
    }
    return row.undo_pending_at === null || now.getTime() - row.undo_pending_at.getTime() >= MOVE_PENDING_MAX_AGE_MS;
  });
}

async function findHitsIn(
  deps: UserMovesDeps,
  ctx: TenantContext,
  mailboxId: string,
  folder: SyncFolderRow,
  inFolder: readonly MoveCandidateRow[]
): Promise<Hit[]> {
  const uids = [...new Set(inFolder.map((row) => row.uid))].sort((a, b) => a - b);
  const size = deps.chunkSize ?? MOVE_CHECK_CHUNK;
  const metas: FolderMessageMeta[] = [];
  for (let offset = 0; offset < uids.length; offset += size) {
    metas.push(...(await deps.provider.fetchByUidsIn(folder.path, uids.slice(offset, offset + size))));
  }
  const hits: Hit[] = [];
  for (const hit of matchMoved(metas, inFolder)) {
    const row = inFolder.find((candidate) => candidate.id === hit.emailId);
    if (row === undefined) continue;
    // Another row of the same identity holds this UID in the folder: the mail is that row's.
    const held = await listFolderUids(deps.db, ctx, mailboxId, folder.path, {
      exceptEmailId: row.id,
      messageId: row.message_id_header,
      contentHash: row.content_hash,
    });
    if (held.has(hit.uid)) continue;
    hits.push({ row, uid: hit.uid, kind: row.folder !== row.source_folder ? "returned" : "relocated" });
  }
  return hits;
}

/**
 * For gone mail (the flag refresh did not find its UID in its folder), looks at the same UID in each synced folder
 * below its cursor and writes the new location of a mail that it finds there.
 */
export async function findUserMoves(
  deps: UserMovesDeps,
  ctx: TenantContext,
  mailboxId: string,
  gone: readonly FlagTarget[],
  opts: { skipFolders?: readonly SyncFolderKey[] } = {}
): Promise<UserMovesResult> {
  const result: UserMovesResult = { checked: 0, returned: 0, relocated: 0, retry: 0 };
  if (gone.length === 0) return result;

  const rows = await listMoveCandidates(
    deps.db,
    ctx,
    mailboxId,
    gone.map((target) => target.emailId)
  );
  let remaining = stillGone(rows, gone, deps.now());
  result.checked = remaining.length;
  log.info("user_moves_checked", { mailbox_id: mailboxId, count: result.checked });
  if (result.checked === 0) return result;

  const folders = await listSyncFolders(deps.db, ctx, mailboxId, { enabledOnly: true });
  for (const folder of folders) {
    if (remaining.length === 0) break;
    const lastUid = folder.last_uid;
    if (opts.skipFolders?.includes(folder.key) || folder.uidvalidity === null || lastUid === null) continue;
    const inFolder = remaining.filter((row) => row.folder !== folder.path && row.uid <= lastUid);
    if (inFolder.length === 0) continue;

    const hits = await findHitsIn(deps, ctx, mailboxId, folder, inFolder);
    if (hits.length === 0) continue;
    // A row found here is not looked for in a later folder.
    const found = new Set(hits.map((hit) => hit.row.id));
    remaining = remaining.filter((row) => !found.has(row.id));

    const run = async (trx: Transaction<DB>): Promise<void> => {
      const locked = await lockSyncFolder(trx, ctx, folder.id);
      if (locked?.uidvalidity !== folder.uidvalidity || locked.last_uid !== folder.last_uid) {
        throw new CursorMovedError(`cursor of mailbox ${mailboxId} moved during the move check`);
      }
      for (const hit of hits) {
        const changed =
          hit.kind === "returned"
            ? await markEmailReturned(trx, ctx, hit.row.id, hit.uid, deps.now(), {
                folder: folder.path,
                from: { folder: hit.row.folder, uid: hit.row.uid },
              })
            : await markEmailRelocated(trx, ctx, hit.row.id, {
                from: hit.row.folder,
                to: folder.path,
                uid: hit.uid,
                fromUid: hit.row.uid,
              });
        // A false means another writer changed the row first.
        if (!changed) continue;
        result[hit.kind] += 1;
        log.debug("user_move_found", {
          mailbox_id: mailboxId,
          email_id: hit.row.id,
          folder_key: folder.key,
          kind: hit.kind,
        });
      }
    };
    try {
      await (deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run));
    } catch (error) {
      if (!(error instanceof CursorMovedError)) throw error;
      result.retry += hits.length;
    }
  }

  if (result.returned + result.relocated > 0) {
    log.info("user_moves_found", { mailbox_id: mailboxId, count: result.returned + result.relocated });
  }
  if (result.retry > 0) log.info("user_moves_retry", { mailbox_id: mailboxId, count: result.retry });
  return result;
}
