import { DAY_MS } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { createLog, type Log } from "../../platform/log";

import { storeCapture } from "./capture-store";
import { locateKeyOf, locateMessage } from "./locate";
import type { CapturedHeaders, FolderMessageMeta } from "./port";
import {
  findCopies,
  insertEmail,
  listFolderRowsAtUids,
  listFolderUids,
  listRecentlyMoved,
  lockSyncFolder,
  markEmailReturned,
  type Cursor,
  type MovedRow,
  type SyncFolderRow,
} from "./repo";
import {
  baseDedupKey,
  contentHash,
  decideBelowCursorCopy,
  dropHeldMetas,
  matchReturned,
  normalizeMessageId,
} from "./sync-rules";
import { CursorMovedError, newRow, withRunCopies, type RunState, type SyncDeps, type SyncResult } from "./sync-run";

const log = createLog("mail");

// system-moved mail that the check looks at for a user move back below the cursor.
export const RETURN_CHECK_WINDOW_MS = 7 * DAY_MS;

export const RETURN_CHECK_LIMIT = 500;

export const RETURN_CHECK_CHUNK = 100;

interface PlannedCopy {
  rowId: string;
  baseKey: string;
  dedupKey: string;
  meta: FolderMessageMeta;
  messageId: string | null;
  hash: string;
  body: string | null;
  capture: CapturedHeaders | null;
}

function logCopySkipped(mailboxLog: Log, rowId: string, kind: string): void {
  mailboxLog.debug("sync_below_cursor_copy_skipped", { email_id: rowId, kind });
}

// A mail that the user puts back into its source folder can keep its UID (Interia) and then sits below that folder's cursor.
// A copy of a mail that is still in its system folder is stored like a new mail.
export async function checkReturnedBelowCursor(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  folder: SyncFolderRow,
  cursor: Cursor,
  result: SyncResult,
  state: RunState
): Promise<void> {
  const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
  const now = deps.now();
  const rows = await listRecentlyMoved(deps.db, ctx, mailboxId, {
    sourceFolder: folder.path,
    movedAfter: new Date(now.getTime() - RETURN_CHECK_WINDOW_MS),
    limit: RETURN_CHECK_LIMIT,
  });
  if (rows.length === 0) return;
  if (rows.length === RETURN_CHECK_LIMIT) {
    mailboxLog.warn("sync_below_cursor_limit", { folder_key: folder.key, limit: rows.length });
  }

  for (let offset = 0; offset < rows.length; offset += RETURN_CHECK_CHUNK) {
    const chunk = rows.slice(offset, offset + RETURN_CHECK_CHUNK);
    const uids = [
      ...new Set(chunk.flatMap((row) => (row.source_uid === null ? [row.uid] : [row.source_uid, row.uid]))),
    ];
    const metas = await deps.provider.fetchByUidsIn(folder.path, uids);
    // A meta at a UID that a row of its identity holds in the folder is that row's mail (a stored copy), not a return.
    const held = await listFolderRowsAtUids(
      deps.db,
      ctx,
      mailboxId,
      folder.path,
      metas.map((meta) => meta.uid)
    );
    const returns: { emailId: string; uid: number }[] = [];
    const planned: PlannedCopy[] = [];
    for (const hit of matchReturned(dropHeldMetas(metas, held), chunk)) {
      const row = chunk.find((candidate) => candidate.id === hit.emailId);
      const meta = metas.find((candidate) => candidate.uid === hit.uid);
      if (row === undefined || meta === undefined) throw new HardError("matched row is missing");
      const foundUid = await findInFolder(deps, ctx, mailboxId, row);
      if (foundUid === null) {
        returns.push(hit);
        continue;
      }
      mailboxLog.debug("sync_below_cursor_copy", { email_id: row.id });
      result.copiesBelowCursor += 1;
      const copy = await planCopy(deps, ctx, mailboxId, folder, row, meta, foundUid, planned, state);
      if (copy !== null) planned.push(copy);
    }
    if (returns.length === 0 && planned.length === 0) continue;

    const run = async (trx: Transaction<DB>) => {
      const locked = await lockSyncFolder(trx, ctx, folder.id);
      if (locked?.uidvalidity !== cursor.uidValidity || locked.last_uid !== cursor.lastUid) {
        throw new CursorMovedError(`cursor of mailbox ${mailboxId} moved during the sync`);
      }
      let returned = 0;
      for (const hit of returns) {
        if (await markEmailReturned(trx, ctx, hit.emailId, hit.uid, now, { folder: folder.path })) returned += 1;
      }
      const stored: PlannedCopy[] = [];
      let missing = 0;
      for (const copy of planned) {
        // The folder lock does not serialize the reads of the plan: decide again with the rows that are committed now.
        const runStored = state.newKeys.get(copy.baseKey) ?? [];
        const fromDb = await findCopies(trx, ctx, mailboxId, { messageId: copy.messageId, contentHash: copy.hash });
        const decision = decideBelowCursorCopy({
          folder: folder.path,
          uid: copy.meta.uid,
          rowId: copy.rowId,
          baseKey: copy.baseKey,
          copies: withRunCopies(fromDb, runStored, copy.meta, copy.hash),
          matched: state.matched,
          now,
        });
        if (decision.kind !== "store" || decision.dedupKey !== copy.dedupKey) {
          logCopySkipped(mailboxLog, copy.rowId, decision.kind === "store" ? "not_inserted" : decision.kind);
          continue;
        }
        const row = newRow(mailboxId, folder.path, copy.meta, copy.messageId, copy.hash, copy.dedupKey, copy.body);
        if (!(await insertEmail(trx, ctx, row))) {
          logCopySkipped(mailboxLog, copy.rowId, "not_inserted");
          continue;
        }
        stored.push(copy);
        const mail = { mailboxId, dedupKey: copy.dedupKey };
        if (copy.capture === null || !(await storeCapture(trx, ctx, mail, copy.capture, now))) missing += 1;
      }
      return { returned, stored, missing };
    };
    try {
      const done = await (deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run));
      result.returnedBelowCursor += done.returned;
      result.stored += done.stored.length;
      result.copiesStored += done.stored.length;
      result.captureMissing += done.missing;
      // The run state changes after the commit only.
      for (const copy of done.stored) {
        const entries = state.newKeys.get(copy.baseKey) ?? [];
        state.newKeys.set(copy.baseKey, [
          ...entries,
          { dedupKey: copy.dedupKey, folder: folder.path, uid: copy.meta.uid },
        ]);
        state.matched.set(`run:${copy.dedupKey}`, folder.path);
      }
    } catch (error) {
      if (!(error instanceof CursorMovedError)) throw error;
      mailboxLog.warn("sync_below_cursor_moved", { folder_key: folder.key });
      break;
    }
  }
  mailboxLog.info("sync_below_cursor_done", {
    folder_key: folder.key,
    checked: rows.length,
    returned: result.returnedBelowCursor,
    copies: result.copiesBelowCursor,
  });
  if (result.copiesStored > 0) {
    mailboxLog.info("sync_below_cursor_copies_stored", {
      folder_key: folder.key,
      count: result.copiesStored,
    });
  }
}

// One copy hit: the copy rule on the rows of its identity, then the body fetch for a copy to store. Null: nothing to store.
async function planCopy(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  folder: SyncFolderRow,
  row: MovedRow,
  meta: FolderMessageMeta,
  foundUid: number,
  planned: readonly PlannedCopy[],
  state: RunState
): Promise<PlannedCopy | null> {
  const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
  // Found only at another UID: it can be an untracked twin while the row's mail came back.
  if (foundUid !== row.uid) {
    logCopySkipped(mailboxLog, row.id, "uncertain");
    return null;
  }
  const messageId = normalizeMessageId(meta.messageId);
  const hash = contentHash(meta);
  const baseKey = baseDedupKey(messageId, hash);
  const fromDb = await findCopies(deps.db, ctx, mailboxId, { messageId, contentHash: hash });
  const earlier = planned
    .filter((copy) => copy.baseKey === baseKey)
    .map((copy) => ({ dedupKey: copy.dedupKey, folder: folder.path, uid: copy.meta.uid }));
  const runStored = [...(state.newKeys.get(baseKey) ?? []), ...earlier];
  const decision = decideBelowCursorCopy({
    folder: folder.path,
    uid: meta.uid,
    rowId: row.id,
    baseKey,
    copies: withRunCopies(fromDb, runStored, meta, hash),
    matched: state.matched,
    now: deps.now(),
  });
  if (decision.kind !== "store") {
    logCopySkipped(mailboxLog, row.id, decision.kind);
    return null;
  }
  const content = await deps.provider.fetchContent(folder.path, meta.uid);
  return {
    rowId: row.id,
    baseKey,
    dedupKey: decision.dedupKey,
    meta,
    messageId,
    hash,
    body: content.text,
    capture: content.capture,
  };
}

// Folder check of a hit (M4): the UID where the mail is still in the folder it was moved to (its source folder holds a copy), else null.
async function findInFolder(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  row: MovedRow
): Promise<number | null> {
  const excludeUids = await listFolderUids(deps.db, ctx, mailboxId, row.folder, {
    exceptEmailId: row.id,
    messageId: row.message_id_header,
    contentHash: row.content_hash,
  });
  const found = await locateMessage(deps.provider, row.folder, locateKeyOf(row, row.uid), { excludeUids });
  return found === null ? null : found.uid;
}
