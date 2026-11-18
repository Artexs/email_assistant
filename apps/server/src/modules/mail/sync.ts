import { DAY_MS, pickSyncFolders, type SyncFolderKey } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { HardError, errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";

import { ensureSyncFolders } from "./folders";
import { LOCATE_CHUNK } from "./locate";
import { MailAuthError, type FolderStatus, type MailProvider, type MessageMeta } from "./port";
import { getMailbox, listSyncFolders, type Cursor, type SyncFolderRow } from "./repo";
import { checkReturnedBelowCursor } from "./sync-below-cursor";
import { applyChunk, planChunk, setCursor } from "./sync-chunk";
import { filterAboveCursor } from "./sync-rules";
import {
  DEFAULT_CHUNK_SIZE,
  emptyResult,
  type MailboxSyncResult,
  type RunState,
  type SyncDeps,
  type SyncResult,
} from "./sync-run";

// The types and the error of a sync run live in `sync-run.ts`; callers keep importing them from here.
export { CursorMovedError, type MailboxSyncResult, type SyncDeps, type SyncResult } from "./sync-run";
export { RETURN_CHECK_CHUNK, RETURN_CHECK_LIMIT, RETURN_CHECK_WINDOW_MS } from "./sync-below-cursor";

const log = createLog("mail");

const INITIAL_WINDOW_MS = DAY_MS;

const RESCAN_WINDOW_MS = 7 * DAY_MS;

function selectMode(folder: SyncFolderRow, status: FolderStatus): SyncResult["mode"] {
  if (folder.uidvalidity === null) return "initial";
  return folder.uidvalidity === status.uidValidity ? "incremental" : "rescan";
}

// Mail of `folder` with INTERNALDATE at or after `since`. IMAP SINCE is by day, so filter again by the time.
export async function fetchSince(
  provider: Pick<MailProvider, "searchSinceIn" | "fetchByUidsIn">,
  folder: string,
  since: Date
): Promise<MessageMeta[]> {
  // SINCE is a date in the server's time zone, but imapflow sends the UTC date: search one day earlier.
  const uids = await provider.searchSinceIn(folder, new Date(since.getTime() - DAY_MS));
  const metas: MessageMeta[] = [];
  for (let i = 0; i < uids.length; i += LOCATE_CHUNK) {
    metas.push(...(await provider.fetchByUidsIn(folder, uids.slice(i, i + LOCATE_CHUNK))));
  }
  const inWindow = metas.filter((meta) => meta.internalDate.getTime() >= since.getTime());
  // Cursor 0 drops no uid: this only sorts and drops repeated uids.
  return filterAboveCursor(inWindow, 0).kept;
}

// One folder of the run, with its own cursor. S = `row.path`.
async function syncFolder(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  row: SyncFolderRow,
  state: RunState
): Promise<SyncResult> {
  const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
  const status = await deps.provider.folderStatus(row.path);
  const mode = selectMode(row, status);
  const result = emptyResult(row.key, mode);

  let kept: MessageMeta[];
  if (mode === "incremental") {
    const metas = await deps.provider.fetchAbove(row.path, row.last_uid ?? 0);
    const filtered = filterAboveCursor(metas, row.last_uid ?? 0);
    kept = filtered.kept;
    result.fetched = metas.length;
    result.ignoredBelowCursor = filtered.ignored;
  } else {
    const windowMs = mode === "initial" ? INITIAL_WINDOW_MS : RESCAN_WINDOW_MS;
    kept = await fetchSince(deps.provider, row.path, new Date(deps.now().getTime() - windowMs));
    result.fetched = kept.length;
  }

  const chunkSize = deps.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const start: Cursor = { uidValidity: row.uidvalidity, lastUid: row.last_uid };
  let cursor = start;
  for (let offset = 0; offset < kept.length; offset += chunkSize) {
    const chunk = kept.slice(offset, offset + chunkSize);
    const writes = await planChunk(deps, ctx, mailboxId, row.path, chunk, state, result);
    if (mode === "incremental") {
      const next: Cursor = { uidValidity: cursor.uidValidity, lastUid: chunk[chunk.length - 1]?.uid ?? cursor.lastUid };
      await applyChunk(deps, ctx, mailboxId, row.id, writes, cursor, next, result);
      cursor = next;
    } else {
      // A crash before the last chunk keeps the old cursor: the next run scans again, the dedup key stops duplicates.
      await applyChunk(deps, ctx, mailboxId, row.id, writes, start, null, result);
    }
  }
  if (mode !== "incremental") {
    const highest = kept[kept.length - 1]?.uid ?? 0;
    const lastUid = Math.max(status.uidNext - 1, highest);
    await setCursor(deps, ctx, mailboxId, row.id, start, { uidValidity: status.uidValidity, lastUid });
  } else {
    await checkReturnedBelowCursor(deps, ctx, mailboxId, row, cursor, result, state);
  }

  mailboxLog.info("sync_folder_done", {
    folder_key: row.key,
    sync_mode: result.mode,
    fetched: result.fetched,
    stored: result.stored,
    uid_updated: result.uidUpdated,
    returned: result.returned,
    relocated: result.relocated,
    cross_copies: result.crossCopies,
    move_in_flight: result.moveInFlight,
    skipped_own: result.skippedOwn,
    ignored_below_cursor: result.ignoredBelowCursor,
  });
  if (result.captureMissing > 0) {
    mailboxLog.warn("capture_missing", { count: result.captureMissing });
  }
  return result;
}

const RESERVED_MAP_KEYS = new Set(["drafts", "sent", "trash"]);

// Insert the rows of the default folders that the server lists. Returns the listed paths (null: unknown) and the new keys.
async function discoverFolders(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  folderMap: Record<string, string>
): Promise<{ listed: Set<string> | null; added: SyncFolderKey[] }> {
  const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
  try {
    const listed = await deps.provider.listFolders();
    const reservedPaths = Object.entries(folderMap)
      .filter(([key]) => RESERVED_MAP_KEYS.has(key) || key.startsWith("ai_"))
      .map(([, path]) => path);
    const picks = pickSyncFolders({ listed, reservedPaths });
    const added = await ensureSyncFolders(deps.db, ctx, mailboxId, picks, deps.now());
    if (added.length > 0) {
      mailboxLog.info("sync_folders_added", { count: added.length });
      for (const key of added) mailboxLog.info("sync_folder_added", { folder_key: key });
    }
    return { listed: new Set(listed.map((folder) => folder.path)), added };
  } catch (error) {
    if (error instanceof MailAuthError) throw error;
    mailboxLog.warn("sync_folder_discovery_failed", errorFields(error));
    return { listed: null, added: [] };
  }
}

export async function syncMailbox(deps: SyncDeps, ctx: TenantContext, mailboxId: string): Promise<MailboxSyncResult> {
  const mailbox = await getMailbox(deps.db, ctx, mailboxId);
  if (!mailbox) throw new HardError(`mailbox ${mailboxId} not found`);
  const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
  const { listed, added } = await discoverFolders(deps, ctx, mailboxId, mailbox.folder_map);

  const rows = await listSyncFolders(deps.db, ctx, mailboxId, { enabledOnly: true });
  if (!rows.some((row) => row.key === "inbox")) throw new HardError("mailbox has no INBOX folder row");

  let state: RunState = { matched: new Map(), newKeys: new Map() };
  const folders: SyncResult[] = [];
  const failed: SyncFolderKey[] = [];
  const skipped: SyncFolderKey[] = [];
  for (const row of rows) {
    if (row.key !== "inbox" && listed !== null && !listed.has(row.path)) {
      mailboxLog.warn("sync_folder_missing", { folder_key: row.key });
      skipped.push(row.key);
      continue;
    }
    // A folder that fails leaves no run-state entry of a chunk that did not commit.
    const before: RunState = { matched: new Map(state.matched), newKeys: new Map(state.newKeys) };
    try {
      folders.push(await syncFolder(deps, ctx, mailboxId, row, state));
    } catch (error) {
      if (error instanceof MailAuthError || row.key === "inbox") throw error;
      state = before;
      mailboxLog.warn("sync_folder_soft_error", { folder_key: row.key, ...errorFields(error) });
      failed.push(row.key);
    }
  }
  const inbox = folders[0];
  if (inbox === undefined) throw new HardError("mailbox has no INBOX folder row");
  return { ...inbox, folders, failed, skipped, added };
}
