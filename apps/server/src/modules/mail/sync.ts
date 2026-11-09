import { pickSyncFolders, type SyncFolderKey } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { describeError, HardError, SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";

import { ensureSyncFolders } from "./folders";
import { LOCATE_CHUNK, locateKeyOf, locateMessage, type LocateKey } from "./locate";
import { INBOX, MailAuthError, type FolderStatus, type MailProvider, type MessageMeta } from "./port";
import {
  findCopies,
  getMailbox,
  getSyncFolder,
  insertEmail,
  listFolderUids,
  listRecentlyMoved,
  listSyncFolders,
  lockSyncFolder,
  markEmailReturned,
  updateEmailUid,
  updateFolderCursor,
  type Cursor,
  type MovedRow,
  type NewEmail,
  type SyncFolderRow,
} from "./repo";
import {
  baseDedupKey,
  contentHash,
  decideIncoming,
  filterAboveCursor,
  matchReturned,
  normalizeMessageId,
  otherCopyUids,
  resolveFolderCheck,
  threadKey,
  type KnownCopy,
} from "./sync-rules";

const log = createLog("mail");

const DEFAULT_CHUNK_SIZE = 50;
const BODY_TEXT_LIMIT = 100_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const INITIAL_WINDOW_MS = DAY_MS;
const RESCAN_WINDOW_MS = 7 * DAY_MS;
// Pilot exception (user, 2026-11-06): the backfill may go back 180 days, past the 30-day body retention (architecture §7).
const BACKFILL_MAX_MS = 180 * DAY_MS;
// D4: system-moved mail that the check looks at for a user move back below the cursor.
export const RETURN_CHECK_WINDOW_MS = 7 * DAY_MS;
export const RETURN_CHECK_LIMIT = 500;
export const RETURN_CHECK_CHUNK = 100;

export interface SyncDeps {
  db: Db | Transaction<DB>;
  provider: MailProvider;
  isOwnActionId(ctx: TenantContext, mailboxId: string, actionId: string): Promise<boolean>;
  now(): Date;
  chunkSize?: number;
}

export interface SyncResult {
  folder: SyncFolderKey;
  mode: "initial" | "incremental" | "rescan" | "backfill";
  fetched: number;
  stored: number;
  uidUpdated: number;
  returned: number;
  relocated: number;
  crossCopies: number;
  /** D9: mail that is the target of a move in flight (not stored). */
  moveInFlight: number;
  returnedBelowCursor: number;
  copiesBelowCursor: number;
  skippedOwn: number;
  ignoredBelowCursor: number;
}

/** The top-level fields are the INBOX result. */
export interface MailboxSyncResult extends SyncResult {
  /** Every folder that synced, INBOX first. */
  folders: SyncResult[];
  /** Folders with an error (D5), never `inbox`. */
  failed: SyncFolderKey[];
  /** Rows whose path the server does not list. */
  skipped: SyncFolderKey[];
  /** Rows that discovery inserted in this run. */
  added: SyncFolderKey[];
}

function emptyResult(folder: SyncFolderKey, mode: SyncResult["mode"]): SyncResult {
  return {
    folder,
    mode,
    fetched: 0,
    stored: 0,
    uidUpdated: 0,
    returned: 0,
    relocated: 0,
    crossCopies: 0,
    moveInFlight: 0,
    returnedBelowCursor: 0,
    copiesBelowCursor: 0,
    skippedOwn: 0,
    ignoredBelowCursor: 0,
  };
}

/** Another run moved the cursor of this mailbox. */
export class CursorMovedError extends SoftError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CursorMovedError";
  }
}

type Write =
  | { kind: "insert"; row: NewEmail }
  | { kind: "update_uid"; emailId: string; uid: number; isSource: boolean }
  | { kind: "returned"; emailId: string; uid: number };

interface RunState {
  /** Email ids (or `run:` ids) that this run already used, with the folder where it matched or stored them (D7). */
  matched: Map<string, string>;
  /** Dedup keys that this run stores, by base key. */
  newKeys: Map<string, string[]>;
}

function newRow(
  mailboxId: string,
  folder: string,
  meta: MessageMeta,
  messageId: string | null,
  hash: string,
  dedupKey: string,
  body: string | null
): NewEmail {
  return {
    mailbox_id: mailboxId,
    dedup_key: dedupKey,
    message_id_header: messageId,
    content_hash: hash,
    uid: meta.uid,
    folder,
    source_folder: folder,
    thread_key: threadKey({ ...meta, messageId }, dedupKey),
    in_reply_to: meta.inReplyTo,
    references_header: meta.references.length > 0 ? meta.references.join(" ") : null,
    from_address: meta.from,
    to_addresses: meta.to,
    cc_addresses: meta.cc,
    subject: meta.subject,
    received_at: meta.internalDate,
    body_text: body === null ? null : body.slice(0, BODY_TEXT_LIMIT),
  };
}

// Phase 1: provider calls and DB reads only.
async function planChunk(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  folder: string,
  chunk: MessageMeta[],
  state: RunState,
  result: SyncResult
): Promise<Write[]> {
  const writes: Write[] = [];
  for (const meta of chunk) {
    if (meta.actionId !== null && (await deps.isOwnActionId(ctx, mailboxId, meta.actionId))) {
      result.skippedOwn += 1;
      continue;
    }
    const messageId = normalizeMessageId(meta.messageId);
    const hash = contentHash(meta);
    const baseKey = baseDedupKey(messageId, hash);
    // Rows that this run stores are copies too, but no other mail of this run can match them.
    const runKeys = state.newKeys.get(baseKey) ?? [];
    const runCopies: KnownCopy[] = runKeys.map((key) => ({
      id: `run:${key}`,
      dedupKey: key,
      folder,
      sourceFolder: folder,
      uid: meta.uid,
      contentHash: hash,
      from: meta.from,
      receivedAt: meta.internalDate,
      movePendingAt: null,
    }));
    const fromDb = await findCopies(deps.db, ctx, mailboxId, { messageId, contentHash: hash });
    const copies = [...fromDb.filter((copy) => !runKeys.includes(copy.dedupKey)), ...runCopies];

    const decision = decideIncoming({ folder, baseKey, copies, matched: state.matched, now: deps.now() });
    let dedupKey: string | null = null;
    if (decision.kind === "move_in_flight") {
      result.moveInFlight += 1;
      log.debug(
        `sync ${mailboxId}: copy of mail ${decision.emailId} in a synced folder is the target of a move, not stored`
      );
    } else if (decision.kind === "update_uid") {
      state.matched.set(decision.emailId, folder);
      writes.push({ kind: "update_uid", emailId: decision.emailId, uid: meta.uid, isSource: decision.isSource });
    } else if (decision.kind === "cross_copy") {
      // Stage 7b: the cross copy. For INBOX nothing is matched elsewhere yet.
      throw new HardError(folder === INBOX ? "unexpected folder check result" : "cross-folder check: stage 7b");
    } else if (decision.kind === "check_folder") {
      if (folder !== INBOX) throw new HardError("cross-folder check: stage 7b");
      state.matched.set(decision.emailId, folder);
      const copy = copies.find((candidate) => candidate.id === decision.emailId);
      if (copy === undefined) throw new HardError("matched copy is missing");
      const key: LocateKey = {
        messageId,
        contentHash: copy.contentHash,
        from: copy.from,
        receivedAt: copy.receivedAt,
        hintUid: copy.uid,
      };
      const excludeUids = otherCopyUids(copies, copy.id, decision.folder);
      const stillInFolder = (await locateMessage(deps.provider, decision.folder, key, { excludeUids })) !== null;
      const check = resolveFolderCheck({
        emailId: decision.emailId,
        stillInFolder,
        systemMoved: decision.systemMoved,
        seenElsewhere: decision.seenElsewhere,
        baseKey,
        copyCount: copies.length,
      });
      if (check.kind === "returned") {
        writes.push({ kind: "returned", emailId: check.emailId, uid: meta.uid });
      } else if (check.kind === "new") {
        dedupKey = check.dedupKey;
      } else {
        // Only INBOX is synced: every copy has the source INBOX and nothing is matched elsewhere (stage 7b).
        throw new HardError("unexpected folder check result");
      }
    } else {
      dedupKey = decision.dedupKey;
    }

    if (dedupKey !== null) {
      const body = await deps.provider.fetchBodyText(folder, meta.uid);
      writes.push({ kind: "insert", row: newRow(mailboxId, folder, meta, messageId, hash, dedupKey, body) });
      state.newKeys.set(baseKey, [...runKeys, dedupKey]);
      state.matched.set(`run:${dedupKey}`, folder);
    }
  }
  return writes;
}

// Phase 2: one transaction that applies the chunk. `next` moves the cursor with it; `null` keeps it.
async function applyChunk(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  folderId: string,
  writes: Write[],
  expected: Cursor,
  next: Cursor | null,
  result: SyncResult
): Promise<void> {
  const run = async (trx: Transaction<DB>) => {
    const folder = await lockSyncFolder(trx, ctx, folderId);
    if (folder?.uidvalidity !== expected.uidValidity || folder.last_uid !== expected.lastUid) {
      throw new CursorMovedError(`cursor of mailbox ${mailboxId} moved during the sync`);
    }
    let stored = 0;
    let uidUpdated = 0;
    let returned = 0;
    for (const write of writes) {
      if (write.kind === "insert") {
        if (await insertEmail(trx, ctx, write.row)) stored += 1;
      } else if (write.kind === "update_uid") {
        await updateEmailUid(trx, ctx, write.emailId, write.uid, { isSource: write.isSource });
        uidUpdated += 1;
      } else {
        await markEmailReturned(trx, ctx, write.emailId, write.uid, deps.now());
        returned += 1;
      }
    }
    if (next !== null && !(await updateFolderCursor(trx, ctx, folderId, expected, next))) {
      throw new CursorMovedError(`cursor of mailbox ${mailboxId} moved during the sync`);
    }
    return { stored, uidUpdated, returned };
  };

  const counts = deps.db.isTransaction
    ? await run(deps.db as Transaction<DB>)
    : await deps.db.transaction().execute(run);
  result.stored += counts.stored;
  result.uidUpdated += counts.uidUpdated;
  result.returned += counts.returned;
}

// After the last chunk of an initial sync or a rescan: set the cursor in one more transaction.
async function setCursor(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  folderId: string,
  expected: Cursor,
  next: Cursor
): Promise<void> {
  const run = async (trx: Transaction<DB>) => {
    if (!(await updateFolderCursor(trx, ctx, folderId, expected, next))) {
      throw new CursorMovedError(`cursor of mailbox ${mailboxId} moved during the sync`);
    }
  };
  await (deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run));
}

// D4: a mail that the user puts back into INBOX can keep its UID (Interia) and then sits below the cursor.
async function checkReturnedBelowCursor(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  folderId: string,
  cursor: Cursor,
  result: SyncResult
): Promise<void> {
  const now = deps.now();
  const rows = await listRecentlyMoved(deps.db, ctx, mailboxId, {
    movedAfter: new Date(now.getTime() - RETURN_CHECK_WINDOW_MS),
    limit: RETURN_CHECK_LIMIT,
  });
  if (rows.length === 0) return;
  if (rows.length === RETURN_CHECK_LIMIT) {
    log.warn(`sync ${mailboxId} returned below cursor: list hit the limit ${rows.length}`);
  }

  for (let offset = 0; offset < rows.length; offset += RETURN_CHECK_CHUNK) {
    const chunk = rows.slice(offset, offset + RETURN_CHECK_CHUNK);
    const uids = [...new Set(chunk.flatMap((row) => (row.inbox_uid === null ? [row.uid] : [row.inbox_uid, row.uid])))];
    const metas = await deps.provider.fetchByUidsIn(INBOX, uids);
    const returns: { emailId: string; uid: number }[] = [];
    for (const hit of matchReturned(metas, chunk)) {
      const row = chunk.find((candidate) => candidate.id === hit.emailId);
      if (row === undefined) throw new HardError("matched row is missing");
      // Another row of the mailbox already holds this INBOX UID (an identical copy that stayed): not a return.
      const inboxUids = await listFolderUids(deps.db, ctx, mailboxId, INBOX, {
        exceptEmailId: row.id,
        messageId: row.message_id_header,
        contentHash: row.content_hash,
      });
      if (inboxUids.has(hit.uid)) continue;
      if (await isStillInFolder(deps, ctx, mailboxId, row)) {
        log.debug(`sync ${mailboxId} copy below cursor: email ${row.id}`);
        result.copiesBelowCursor += 1;
      } else {
        returns.push(hit);
      }
    }
    if (returns.length === 0) continue;

    const run = async (trx: Transaction<DB>): Promise<number> => {
      const folder = await lockSyncFolder(trx, ctx, folderId);
      if (folder?.uidvalidity !== cursor.uidValidity || folder.last_uid !== cursor.lastUid) {
        throw new CursorMovedError(`cursor of mailbox ${mailboxId} moved during the sync`);
      }
      let changed = 0;
      for (const hit of returns) {
        if (await markEmailReturned(trx, ctx, hit.emailId, hit.uid, now, { onlyOutsideInbox: true })) changed += 1;
      }
      return changed;
    };
    try {
      result.returnedBelowCursor += await (deps.db.isTransaction
        ? run(deps.db as Transaction<DB>)
        : deps.db.transaction().execute(run));
    } catch (error) {
      if (!(error instanceof CursorMovedError)) throw error;
      log.warn(`sync ${mailboxId} returned below cursor: cursor moved, check repeats at the next sync`);
      break;
    }
  }
  log.info(
    `sync ${mailboxId} returned below cursor: checked ${rows.length}, returned ${result.returnedBelowCursor}, copies ${result.copiesBelowCursor}`
  );
}

// Folder check of a hit (M4): the mail is still in the folder it was moved to, so INBOX holds a copy.
async function isStillInFolder(deps: SyncDeps, ctx: TenantContext, mailboxId: string, row: MovedRow): Promise<boolean> {
  const excludeUids = await listFolderUids(deps.db, ctx, mailboxId, row.folder, {
    exceptEmailId: row.id,
    messageId: row.message_id_header,
    contentHash: row.content_hash,
  });
  const found = await locateMessage(deps.provider, row.folder, locateKeyOf(row, row.uid), { excludeUids });
  return found !== null;
}

async function readInboxFolder(deps: SyncDeps, ctx: TenantContext, mailboxId: string): Promise<SyncFolderRow> {
  const folder = await getSyncFolder(deps.db, ctx, mailboxId, "inbox");
  if (!folder) throw new HardError("mailbox has no INBOX folder row");
  return folder;
}

function selectMode(folder: SyncFolderRow, status: FolderStatus): SyncResult["mode"] {
  if (folder.uidvalidity === null) return "initial";
  return folder.uidvalidity === status.uidValidity ? "incremental" : "rescan";
}

// Mail of `folder` with INTERNALDATE at or after `since`. IMAP SINCE is by day, so filter again by the time.
export async function fetchSince(provider: MailProvider, folder: string, since: Date): Promise<MessageMeta[]> {
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

// D4 and D5: one folder of the run, with its own cursor. S = `row.path`.
async function syncFolder(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  row: SyncFolderRow,
  state: RunState
): Promise<SyncResult> {
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
  } else if (row.key === "inbox") {
    // Stage 8 makes this check per folder.
    await checkReturnedBelowCursor(deps, ctx, mailboxId, row.id, cursor, result);
  }

  log.info(
    `sync ${mailboxId} folder ${row.key}: ${result.mode}, fetched ${result.fetched}, stored ${result.stored}, uid updated ${result.uidUpdated}, returned ${result.returned}, relocated ${result.relocated}, cross copies ${result.crossCopies}, move in flight ${result.moveInFlight}, skipped own ${result.skippedOwn}, ignored below cursor ${result.ignoredBelowCursor}`
  );
  return result;
}

const RESERVED_MAP_KEYS = new Set(["drafts", "sent", "trash"]);

// D2: insert the rows of the default folders that the server lists. Returns the listed paths (null: unknown) and the new keys.
async function discoverFolders(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  folderMap: Record<string, string>
): Promise<{ listed: Set<string> | null; added: SyncFolderKey[] }> {
  try {
    const listed = await deps.provider.listFolders();
    const reservedPaths = Object.entries(folderMap)
      .filter(([key]) => RESERVED_MAP_KEYS.has(key) || key.startsWith("ai_"))
      .map(([, path]) => path);
    const picks = pickSyncFolders({ listed, reservedPaths });
    const added = await ensureSyncFolders(deps.db, ctx, mailboxId, picks, deps.now());
    if (added.length > 0) log.info(`sync ${mailboxId}: added sync folders ${added.join(",")}`);
    return { listed: new Set(listed.map((folder) => folder.path)), added };
  } catch (error) {
    if (error instanceof MailAuthError) throw error;
    log.warn(`sync ${mailboxId}: folder discovery failed: ${describeError(error)}`);
    return { listed: null, added: [] };
  }
}

export async function syncMailbox(deps: SyncDeps, ctx: TenantContext, mailboxId: string): Promise<MailboxSyncResult> {
  const mailbox = await getMailbox(deps.db, ctx, mailboxId);
  if (!mailbox) throw new HardError(`mailbox ${mailboxId} not found`);
  const { listed, added } = await discoverFolders(deps, ctx, mailboxId, mailbox.folder_map);

  const rows = await listSyncFolders(deps.db, ctx, mailboxId, { enabledOnly: true });
  if (!rows.some((row) => row.key === "inbox")) throw new HardError("mailbox has no INBOX folder row");

  const state: RunState = { matched: new Map(), newKeys: new Map() };
  const folders: SyncResult[] = [];
  const failed: SyncFolderKey[] = [];
  const skipped: SyncFolderKey[] = [];
  for (const row of rows) {
    if (row.key !== "inbox" && listed !== null && !listed.has(row.path)) {
      log.warn(`sync ${mailboxId} folder ${row.key}: not on the server, skipped`);
      skipped.push(row.key);
      continue;
    }
    try {
      folders.push(await syncFolder(deps, ctx, mailboxId, row, state));
    } catch (error) {
      if (error instanceof MailAuthError || row.key === "inbox") throw error;
      log.warn(`sync ${mailboxId} folder ${row.key}: ${describeError(error)}; the next tick tries again`);
      failed.push(row.key);
    }
  }
  const inbox = folders[0];
  if (inbox === undefined) throw new HardError("mailbox has no INBOX folder row");
  return { ...inbox, folders, failed, skipped, added };
}

/**
 * One-off, read-only fetch of older INBOX mail from `opts.since` on. Stores the missing mails with
 * `backfilled_at` and never moves the cursor.
 */
export async function backfillInbox(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date }
): Promise<SyncResult> {
  if (opts.since.getTime() < deps.now().getTime() - BACKFILL_MAX_MS) {
    throw new HardError("backfill since is more than 180 days back");
  }
  const mailbox = await getMailbox(deps.db, ctx, mailboxId);
  if (!mailbox) throw new HardError(`mailbox ${mailboxId} not found`);
  const folder = await readInboxFolder(deps, ctx, mailboxId);
  if (folder.uidvalidity === null) throw new HardError("mailbox was never synced: run the sync first");

  const status = await deps.provider.folderStatus(INBOX);
  if (status.uidValidity !== folder.uidvalidity) {
    throw new SoftError("UIDVALIDITY changed: wait for the regular sync to rescan, then run the backfill again");
  }

  const kept = await fetchSince(deps.provider, INBOX, opts.since);
  const result: SyncResult = { ...emptyResult("inbox", "backfill"), fetched: kept.length };

  const chunkSize = deps.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const state: RunState = { matched: new Map(), newKeys: new Map() };
  const start: Cursor = { uidValidity: folder.uidvalidity, lastUid: folder.last_uid };
  for (let offset = 0; offset < kept.length; offset += chunkSize) {
    const chunk = kept.slice(offset, offset + chunkSize);
    const writes = await planChunk(deps, ctx, mailboxId, INBOX, chunk, state, result);
    const backfilledAt = deps.now();
    for (const write of writes) {
      if (write.kind === "insert") write.row.backfilled_at = backfilledAt;
    }
    // `next` is null: the cursor never moves.
    await applyChunk(deps, ctx, mailboxId, folder.id, writes, start, null, result);
  }

  log.info(
    `backfill ${mailboxId}: fetched ${result.fetched}, stored ${result.stored}, uid updated ${result.uidUpdated}, returned ${result.returned}, skipped own ${result.skippedOwn}`
  );
  return result;
}
