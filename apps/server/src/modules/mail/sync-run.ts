import type { SyncFolderKey } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { SoftError } from "../../platform/errors";

import type { MailProvider, MessageMeta } from "./port";
import type { NewEmail } from "./repo";
import { threadKey, type KnownCopy } from "./sync-rules";

export const DEFAULT_CHUNK_SIZE = 50;

const BODY_TEXT_LIMIT = 100_000;

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
  /** Stored mail without an `email_headers` row: no capture, or the header insert failed. */
  captureMissing: number;
  uidUpdated: number;
  returned: number;
  relocated: number;
  crossCopies: number;
  /** D9: mail that is the target of a move in flight (not stored). */
  moveInFlight: number;
  returnedBelowCursor: number;
  copiesBelowCursor: number;
  /** Copies below the cursor that the end-of-run check stored (they are also in `stored`). */
  copiesStored: number;
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

export function emptyResult(folder: SyncFolderKey, mode: SyncResult["mode"]): SyncResult {
  return {
    folder,
    mode,
    fetched: 0,
    stored: 0,
    captureMissing: 0,
    uidUpdated: 0,
    returned: 0,
    relocated: 0,
    crossCopies: 0,
    moveInFlight: 0,
    returnedBelowCursor: 0,
    copiesBelowCursor: 0,
    copiesStored: 0,
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

export interface RunState {
  /** Email ids (or `run:` ids) that this run already used, with the folder where it matched or stored them (D7). */
  matched: Map<string, string>;
  /** The rows that this run stores, by base key, with the folder and UID where it stored them. */
  newKeys: Map<string, { dedupKey: string; folder: string; uid: number }[]>;
}

export function newRow(
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

// The rows of one identity: the DB rows plus the rows that this run stored, which enter as `run:` copies (deduplicated by dedup key).
export function withRunCopies(
  fromDb: KnownCopy[],
  runStored: readonly { dedupKey: string; folder: string; uid: number }[],
  meta: MessageMeta,
  hash: string
): KnownCopy[] {
  const runKeys = runStored.map((stored) => stored.dedupKey);
  const runCopies: KnownCopy[] = runStored.map((stored) => ({
    id: `run:${stored.dedupKey}`,
    dedupKey: stored.dedupKey,
    folder: stored.folder,
    sourceFolder: stored.folder,
    uid: stored.uid,
    contentHash: hash,
    from: meta.from,
    receivedAt: meta.internalDate,
    movePendingAt: null,
  }));
  return [...fromDb.filter((copy) => !runKeys.includes(copy.dedupKey)), ...runCopies];
}
