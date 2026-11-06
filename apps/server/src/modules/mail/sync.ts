import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError, SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";

import { INBOX, type InboxStatus, type MailProvider, type MessageMeta } from "./port";
import {
  findCopies,
  getMailbox,
  insertEmail,
  lockMailbox,
  markEmailReturned,
  updateCursor,
  updateEmailUid,
  type Cursor,
  type MailboxRow,
  type NewEmail,
} from "./repo";
import {
  baseDedupKey,
  contentHash,
  decideIncoming,
  filterAboveCursor,
  normalizeMessageId,
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

export interface SyncDeps {
  db: Db | Transaction<DB>;
  provider: MailProvider;
  isOwnActionId(ctx: TenantContext, mailboxId: string, actionId: string): Promise<boolean>;
  now(): Date;
  chunkSize?: number;
}

export interface SyncResult {
  mode: "initial" | "incremental" | "rescan" | "backfill";
  fetched: number;
  stored: number;
  uidUpdated: number;
  returned: number;
  skippedOwn: number;
  ignoredBelowCursor: number;
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
  | { kind: "update_uid"; emailId: string; uid: number }
  | { kind: "returned"; emailId: string; uid: number };

interface RunState {
  /** Email ids that this run already used. */
  matched: Set<string>;
  /** Dedup keys that this run stores, by base key. */
  newKeys: Map<string, string[]>;
}

function newRow(
  mailboxId: string,
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
    folder: INBOX,
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
    const runCopies: KnownCopy[] = runKeys.map((key) => ({ id: `run:${key}`, dedupKey: key, folder: INBOX }));
    for (const copy of runCopies) state.matched.add(copy.id);
    const fromDb = await findCopies(deps.db, ctx, mailboxId, { messageId, contentHash: hash });
    const copies = [...fromDb.filter((copy) => !runKeys.includes(copy.dedupKey)), ...runCopies];

    const decision = decideIncoming({ baseKey, copies, matched: state.matched });
    let dedupKey: string | null = null;
    if (decision.kind === "update_uid") {
      state.matched.add(decision.emailId);
      writes.push({ kind: "update_uid", emailId: decision.emailId, uid: meta.uid });
    } else if (decision.kind === "check_folder") {
      state.matched.add(decision.emailId);
      // Without a Message-ID the folder cannot be searched: treat the mail as returned.
      const stillInFolder =
        messageId !== null && (await deps.provider.findByMessageId(decision.folder, messageId)) !== null;
      const check = resolveFolderCheck({ emailId: decision.emailId, stillInFolder, baseKey, copyCount: copies.length });
      if (check.kind === "returned") {
        writes.push({ kind: "returned", emailId: check.emailId, uid: meta.uid });
      } else {
        dedupKey = check.dedupKey;
      }
    } else {
      dedupKey = decision.dedupKey;
    }

    if (dedupKey !== null) {
      const body = await deps.provider.fetchBodyText(meta.uid);
      writes.push({ kind: "insert", row: newRow(mailboxId, meta, messageId, hash, dedupKey, body) });
      state.newKeys.set(baseKey, [...runKeys, dedupKey]);
    }
  }
  return writes;
}

// Phase 2: one transaction that applies the chunk. `next` moves the cursor with it; `null` keeps it.
async function applyChunk(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  writes: Write[],
  expected: Cursor,
  next: Cursor | null,
  result: SyncResult
): Promise<void> {
  const run = async (trx: Transaction<DB>) => {
    const mailbox = await lockMailbox(trx, ctx, mailboxId);
    if (mailbox?.uidvalidity !== expected.uidValidity || mailbox.last_uid !== expected.lastUid) {
      throw new CursorMovedError(`cursor of mailbox ${mailboxId} moved during the sync`);
    }
    let stored = 0;
    let uidUpdated = 0;
    let returned = 0;
    for (const write of writes) {
      if (write.kind === "insert") {
        if (await insertEmail(trx, ctx, write.row)) stored += 1;
      } else if (write.kind === "update_uid") {
        await updateEmailUid(trx, ctx, write.emailId, write.uid);
        uidUpdated += 1;
      } else {
        await markEmailReturned(trx, ctx, write.emailId, write.uid, deps.now());
        returned += 1;
      }
    }
    if (next !== null && !(await updateCursor(trx, ctx, mailboxId, expected, next))) {
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
  expected: Cursor,
  next: Cursor
): Promise<void> {
  const run = async (trx: Transaction<DB>) => {
    if (!(await updateCursor(trx, ctx, mailboxId, expected, next))) {
      throw new CursorMovedError(`cursor of mailbox ${mailboxId} moved during the sync`);
    }
  };
  await (deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run));
}

function selectMode(mailbox: MailboxRow, status: InboxStatus): SyncResult["mode"] {
  if (mailbox.uidvalidity === null) return "initial";
  return mailbox.uidvalidity === status.uidValidity ? "incremental" : "rescan";
}

// INBOX mail with INTERNALDATE at or after `since`. IMAP SINCE is by day, so filter again by the time.
export async function fetchSince(provider: MailProvider, since: Date): Promise<MessageMeta[]> {
  // SINCE is a date in the server's time zone, but imapflow sends the UTC date: search one day earlier.
  const uids = await provider.searchInboxSince(new Date(since.getTime() - DAY_MS));
  if (uids.length === 0) return [];
  const metas = await provider.fetchByUids(uids);
  const inWindow = metas.filter((meta) => meta.internalDate.getTime() >= since.getTime());
  // Cursor 0 drops no uid: this only sorts and drops repeated uids.
  return filterAboveCursor(inWindow, 0).kept;
}

export async function syncMailbox(deps: SyncDeps, ctx: TenantContext, mailboxId: string): Promise<SyncResult> {
  const mailbox = await getMailbox(deps.db, ctx, mailboxId);
  if (!mailbox) throw new HardError(`mailbox ${mailboxId} not found`);

  const status = await deps.provider.inboxStatus();
  const mode = selectMode(mailbox, status);
  const result: SyncResult = {
    mode,
    fetched: 0,
    stored: 0,
    uidUpdated: 0,
    returned: 0,
    skippedOwn: 0,
    ignoredBelowCursor: 0,
  };

  let kept: MessageMeta[];
  if (mode === "incremental") {
    const metas = await deps.provider.fetchAbove(mailbox.last_uid ?? 0);
    const filtered = filterAboveCursor(metas, mailbox.last_uid ?? 0);
    kept = filtered.kept;
    result.fetched = metas.length;
    result.ignoredBelowCursor = filtered.ignored;
  } else {
    const windowMs = mode === "initial" ? INITIAL_WINDOW_MS : RESCAN_WINDOW_MS;
    kept = await fetchSince(deps.provider, new Date(deps.now().getTime() - windowMs));
    result.fetched = kept.length;
  }

  const chunkSize = deps.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const state: RunState = { matched: new Set(), newKeys: new Map() };
  const start: Cursor = { uidValidity: mailbox.uidvalidity, lastUid: mailbox.last_uid };
  let cursor = start;
  for (let offset = 0; offset < kept.length; offset += chunkSize) {
    const chunk = kept.slice(offset, offset + chunkSize);
    const writes = await planChunk(deps, ctx, mailboxId, chunk, state, result);
    if (mode === "incremental") {
      const next: Cursor = { uidValidity: cursor.uidValidity, lastUid: chunk[chunk.length - 1]?.uid ?? cursor.lastUid };
      await applyChunk(deps, ctx, mailboxId, writes, cursor, next, result);
      cursor = next;
    } else {
      // A crash before the last chunk keeps the old cursor: the next run scans again, the dedup key stops duplicates.
      await applyChunk(deps, ctx, mailboxId, writes, start, null, result);
    }
  }
  if (mode !== "incremental") {
    const highest = kept[kept.length - 1]?.uid ?? 0;
    const lastUid = Math.max(status.uidNext - 1, highest);
    await setCursor(deps, ctx, mailboxId, start, { uidValidity: status.uidValidity, lastUid });
  }

  log.info(
    `sync ${mailboxId} ${result.mode}: fetched ${result.fetched}, stored ${result.stored}, uid updated ${result.uidUpdated}, returned ${result.returned}, skipped own ${result.skippedOwn}, ignored below cursor ${result.ignoredBelowCursor}`
  );
  return result;
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
  if (mailbox.uidvalidity === null) throw new HardError("mailbox was never synced: run the sync first");

  const status = await deps.provider.inboxStatus();
  if (status.uidValidity !== mailbox.uidvalidity) {
    throw new SoftError("UIDVALIDITY changed: wait for the regular sync to rescan, then run the backfill again");
  }

  const kept = await fetchSince(deps.provider, opts.since);
  const result: SyncResult = {
    mode: "backfill",
    fetched: kept.length,
    stored: 0,
    uidUpdated: 0,
    returned: 0,
    skippedOwn: 0,
    ignoredBelowCursor: 0,
  };

  const chunkSize = deps.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const state: RunState = { matched: new Set(), newKeys: new Map() };
  const start: Cursor = { uidValidity: mailbox.uidvalidity, lastUid: mailbox.last_uid };
  for (let offset = 0; offset < kept.length; offset += chunkSize) {
    const chunk = kept.slice(offset, offset + chunkSize);
    const writes = await planChunk(deps, ctx, mailboxId, chunk, state, result);
    const backfilledAt = deps.now();
    for (const write of writes) {
      if (write.kind === "insert") write.row.backfilled_at = backfilledAt;
    }
    // `next` is null: the cursor never moves.
    await applyChunk(deps, ctx, mailboxId, writes, start, null, result);
  }

  log.info(
    `backfill ${mailboxId}: fetched ${result.fetched}, stored ${result.stored}, uid updated ${result.uidUpdated}, returned ${result.returned}, skipped own ${result.skippedOwn}`
  );
  return result;
}
