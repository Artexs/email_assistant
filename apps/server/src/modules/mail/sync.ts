import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError, SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";

import { INBOX, type MailProvider, type MessageMeta } from "./port";
import {
  findCopies,
  getMailbox,
  insertEmail,
  lockMailbox,
  markEmailReturned,
  updateCursor,
  updateEmailUid,
  type Cursor,
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

export interface SyncDeps {
  db: Db | Transaction<DB>;
  provider: MailProvider;
  isOwnActionId(ctx: TenantContext, mailboxId: string, actionId: string): Promise<boolean>;
  now(): Date;
  chunkSize?: number;
}

export interface SyncResult {
  mode: "initial" | "incremental" | "rescan";
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

// Phase 2: one transaction that applies the chunk and moves the cursor with it.
async function applyChunk(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  writes: Write[],
  expected: Cursor,
  next: Cursor,
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
    if (!(await updateCursor(trx, ctx, mailboxId, expected, next))) {
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

export async function syncMailbox(deps: SyncDeps, ctx: TenantContext, mailboxId: string): Promise<SyncResult> {
  const mailbox = await getMailbox(deps.db, ctx, mailboxId);
  if (!mailbox) throw new HardError(`mailbox ${mailboxId} not found`);

  const status = await deps.provider.inboxStatus();
  if (mailbox.uidvalidity === null || mailbox.uidvalidity !== status.uidValidity) {
    throw new HardError("initial sync and rescan come in stage 7");
  }

  const result: SyncResult = {
    mode: "incremental",
    fetched: 0,
    stored: 0,
    uidUpdated: 0,
    returned: 0,
    skippedOwn: 0,
    ignoredBelowCursor: 0,
  };
  const metas = await deps.provider.fetchAbove(mailbox.last_uid ?? 0);
  const { kept, ignored } = filterAboveCursor(metas, mailbox.last_uid ?? 0);
  result.fetched = metas.length;
  result.ignoredBelowCursor = ignored;

  const chunkSize = deps.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const state: RunState = { matched: new Set(), newKeys: new Map() };
  let cursor: Cursor = { uidValidity: mailbox.uidvalidity, lastUid: mailbox.last_uid };
  for (let start = 0; start < kept.length; start += chunkSize) {
    const chunk = kept.slice(start, start + chunkSize);
    const writes = await planChunk(deps, ctx, mailboxId, chunk, state, result);
    const next: Cursor = { uidValidity: cursor.uidValidity, lastUid: chunk[chunk.length - 1]?.uid ?? cursor.lastUid };
    await applyChunk(deps, ctx, mailboxId, writes, cursor, next, result);
    cursor = next;
  }

  log.info(
    `sync ${mailboxId} ${result.mode}: fetched ${result.fetched}, stored ${result.stored}, uid updated ${result.uidUpdated}, returned ${result.returned}, skipped own ${result.skippedOwn}, ignored below cursor ${result.ignoredBelowCursor}`
  );
  return result;
}
