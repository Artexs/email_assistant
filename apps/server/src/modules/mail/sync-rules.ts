import { createHash } from "node:crypto";

import { INBOX, type FolderMessageMeta, type MessageMeta } from "./port";
import type { MovedRow } from "./repo";

// Pure dedup and "is this mail new" rules (docs/architecture.md §6.1).
// A known mail is never triaged again: `update_uid` and `returned` never change `status`.

export function normalizeMessageId(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** SHA-256 hex of the From address, the Date header (else INTERNALDATE) and RFC822.SIZE. */
export function contentHash(meta: Pick<MessageMeta, "from" | "date" | "internalDate" | "size">): string {
  const from = meta.from?.trim().toLowerCase() ?? "";
  const date = meta.date !== null && !Number.isNaN(meta.date.getTime()) ? meta.date : meta.internalDate;
  return createHash("sha256").update(`${from}\n${date.toISOString()}\n${meta.size}`).digest("hex");
}

/** The same Message-ID with a different hash is a new mail. */
export function baseDedupKey(messageId: string | null, hash: string): string {
  return messageId === null ? `hash:${hash}` : `mid:${messageId}:${hash}`;
}

/** n = 1 → base; n >= 2 → `${base}#${n}`. */
export function copyDedupKey(base: string, n: number): string {
  return n === 1 ? base : `${base}#${n}`;
}

/** First reference, else In-Reply-To, else the own Message-ID, else `fallback` (the dedup key). */
export function threadKey(meta: Pick<MessageMeta, "references" | "inReplyTo" | "messageId">, fallback: string): string {
  return meta.references[0] ?? meta.inReplyTo ?? meta.messageId ?? fallback;
}

/** `UID FETCH n:*` also returns the highest message when its uid is below n: drop it. */
export function filterAboveCursor(metas: MessageMeta[], lastUid: number): { kept: MessageMeta[]; ignored: number } {
  const seen = new Set<number>();
  const kept: MessageMeta[] = [];
  for (const meta of metas) {
    if (meta.uid <= lastUid || seen.has(meta.uid)) continue;
    seen.add(meta.uid);
    kept.push(meta);
  }
  kept.sort((a, b) => a.uid - b.uid);
  return { kept, ignored: metas.length - kept.length };
}

export interface KnownCopy {
  id: string;
  dedupKey: string;
  folder: string;
  /** The UID the row holds in `folder`. */
  uid: number;
  contentHash: string;
  from: string | null;
  receivedAt: Date;
  /** D22: set while a reverse move of the mail is in flight. */
  undoPendingAt: Date | null;
}

/** UIDs that the other rows of the same identity hold in `folder`: they are never the copy of row `exceptId`. */
export function otherCopyUids(copies: readonly KnownCopy[], exceptId: string, folder: string): Set<number> {
  return new Set(copies.filter((copy) => copy.id !== exceptId && copy.folder === folder).map((copy) => copy.uid));
}

export type IncomingDecision =
  | { kind: "update_uid"; emailId: string }
  | { kind: "check_folder"; emailId: string; folder: string }
  | { kind: "new"; dedupKey: string };

// The base key ends with the hex hash, so a trailing `#<n>` only comes from copyDedupKey.
function copyNumber(dedupKey: string): number {
  const match = /#(\d+)$/.exec(dedupKey);
  return match?.[1] === undefined ? 1 : Number(match[1]);
}

/**
 * `copies` = rows with the same Message-ID and hash; `matched` = email ids that this sync run
 * already used.
 */
export function decideIncoming(input: {
  baseKey: string;
  copies: KnownCopy[];
  matched: ReadonlySet<string>;
}): IncomingDecision {
  const free = [...input.copies]
    .sort((a, b) => copyNumber(a.dedupKey) - copyNumber(b.dedupKey))
    .filter((copy) => !input.matched.has(copy.id));
  const inInbox = free.find((copy) => copy.folder === INBOX);
  if (inInbox !== undefined) return { kind: "update_uid", emailId: inInbox.id };
  const elsewhere = free[0];
  if (elsewhere !== undefined) {
    return { kind: "check_folder", emailId: elsewhere.id, folder: elsewhere.folder };
  }
  return { kind: "new", dedupKey: copyDedupKey(input.baseKey, input.copies.length + 1) };
}

export type FolderCheckResult =
  | { kind: "returned"; emailId: string }
  | { kind: "new"; dedupKey: string }
  | { kind: "undo_in_flight"; emailId: string };

/** D22: an `undo_pending_at` older than this is a leftover; the old rule applies. */
export const UNDO_PENDING_MAX_AGE_MS = 24 * 3_600_000;

/**
 * Still in its folder → a second identical copy (store and triage it), unless a reverse move of the
 * known copy is in flight (D22): then the incoming mail is its target, store nothing.
 * Gone → the user moved it back (the caller sets `returned_at` and `folder = INBOX`).
 */
export function resolveFolderCheck(input: {
  emailId: string;
  stillInFolder: boolean;
  baseKey: string;
  copyCount: number;
  undoPendingAt: Date | null;
  now: Date;
}): FolderCheckResult {
  if (input.stillInFolder) {
    const { undoPendingAt, now } = input;
    if (undoPendingAt && now.getTime() - undoPendingAt.getTime() < UNDO_PENDING_MAX_AGE_MS) {
      return { kind: "undo_in_flight", emailId: input.emailId };
    }
    return { kind: "new", dedupKey: copyDedupKey(input.baseKey, input.copyCount + 1) };
  }
  return { kind: "returned", emailId: input.emailId };
}

/** "strict": Message-ID and hash. "no_size": for a server that changes RFC822.SIZE on a COPY. */
export type IdentityMode = "strict" | "no_size";

// Stage 1 result (Interia, 2026-11-07): a COPY keeps RFC822.SIZE and INTERNALDATE.
export const IDENTITY_MODE: IdentityMode = "strict";

/** What a stored `emails` row knows about its mail. */
export interface MailIdentity {
  /** Normalized, as stored in emails.message_id_header. */
  messageId: string | null;
  /** emails.content_hash. */
  contentHash: string;
  /** emails.from_address (no_size mode). */
  from: string | null;
  /** emails.received_at = INTERNALDATE at store time (no_size mode). */
  receivedAt: Date;
}

function toSecond(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** A mail without a Message-ID is compared by its hash only, in both modes. */
export function sameMailIdentity(meta: MessageMeta, key: MailIdentity, mode: IdentityMode = IDENTITY_MODE): boolean {
  if (key.messageId === null) {
    return normalizeMessageId(meta.messageId) === null && contentHash(meta) === key.contentHash;
  }
  if (normalizeMessageId(meta.messageId) !== key.messageId) return false;
  if (mode === "strict") return contentHash(meta) === key.contentHash;
  return (
    (meta.from?.trim().toLowerCase() ?? "") === (key.from?.trim().toLowerCase() ?? "") &&
    toSecond(meta.internalDate) === toSecond(key.receivedAt)
  );
}

/** Another client's delete, or an expunge that failed. */
export function isDeleted(meta: FolderMessageMeta): boolean {
  return meta.flags.includes("\\Deleted");
}

/**
 * D4: the metas of INBOX at the `inbox_uid` and the `uid` of moved rows (a system move gives the mail a new folder
 * UID; a webmail move back keeps it). A meta that is not `\Deleted` and has the identity of the row at one of its
 * UIDs is a mail that came back to INBOX below the cursor.
 */
export function matchReturned(
  metas: readonly FolderMessageMeta[],
  rows: readonly MovedRow[],
  mode: IdentityMode = IDENTITY_MODE
): { emailId: string; uid: number }[] {
  const hits = new Map<string, { emailId: string; uid: number }>();
  for (const meta of metas) {
    if (isDeleted(meta)) continue;
    const matches = rows.filter(
      (candidate) =>
        !hits.has(candidate.id) &&
        (candidate.inbox_uid === meta.uid || candidate.uid === meta.uid) &&
        sameMailIdentity(
          meta,
          {
            messageId: candidate.message_id_header,
            contentHash: candidate.content_hash,
            from: candidate.from_address,
            receivedAt: candidate.received_at,
          },
          mode
        )
    );
    // A row whose `inbox_uid` is the meta UID wins over a row whose folder `uid` is.
    const row = matches.find((candidate) => candidate.inbox_uid === meta.uid) ?? matches[0];
    if (row !== undefined) hits.set(row.id, { emailId: row.id, uid: meta.uid });
  }
  return [...hits.values()];
}
