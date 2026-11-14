import { createHash } from "node:crypto";

import { type FolderMessageMeta, type MessageMeta } from "./port";
import type { MoveCandidateRow, MovedRow } from "./repo";

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
  /** emails.source_folder (D6). */
  sourceFolder: string;
  /** The UID the row holds in `folder`. */
  uid: number;
  contentHash: string;
  from: string | null;
  receivedAt: Date;
  /** emails.undo_pending_at: a system move into a synced folder is in flight (D9). */
  movePendingAt: Date | null;
}

/** D9: a `movePendingAt` older than this is a leftover; the normal rules apply. */
export const MOVE_PENDING_MAX_AGE_MS = 24 * 3_600_000;

/** UIDs that the other rows of the same identity hold in `folder`: they are never the copy of row `exceptId`. */
export function otherCopyUids(copies: readonly KnownCopy[], exceptId: string, folder: string): Set<number> {
  return new Set(copies.filter((copy) => copy.id !== exceptId && copy.folder === folder).map((copy) => copy.uid));
}

/** A free known copy outside the synced folder, in copy-number order. */
export interface FolderCandidate {
  emailId: string;
  folder: string;
  /** folder <> source_folder: the system moved it there. */
  systemMoved: boolean;
}

/** The folder check tries at most this many free copies of one mail. */
export const CHECK_FOLDER_MAX_CANDIDATES = 5;

export type IncomingDecision =
  | { kind: "move_in_flight"; emailId: string }
  | { kind: "update_uid"; emailId: string; isSource: boolean }
  | { kind: "check_folder"; candidates: FolderCandidate[]; seenElsewhere: boolean }
  | { kind: "cross_copy"; emailId: string }
  | { kind: "new"; dedupKey: string };

// The base key ends with the hex hash, so a trailing `#<n>` only comes from copyDedupKey.
function copyNumber(dedupKey: string): number {
  const match = /#(\d+)$/.exec(dedupKey);
  return match?.[1] === undefined ? 1 : Number(match[1]);
}

/**
 * D7. `folder` = S, the synced folder of the incoming mail. `copies` = rows with the same Message-ID and hash.
 * `matched` maps an email id (or `run:<dedup key>` of a row that this run stored) to the folder where this run
 * matched or stored it: such a copy is never free, so it is never located and never `relocated`.
 * check_folder lists the free copies outside S in copy order; the caller checks them until one is gone.
 */
export function decideIncoming(input: {
  folder: string;
  baseKey: string;
  copies: KnownCopy[];
  matched: ReadonlyMap<string, string>;
  now: Date;
}): IncomingDecision {
  const { folder, matched, now } = input;
  const sorted = [...input.copies].sort((a, b) => copyNumber(a.dedupKey) - copyNumber(b.dedupKey));
  const inFlight = sorted.find(
    (copy) => copy.movePendingAt !== null && now.getTime() - copy.movePendingAt.getTime() < MOVE_PENDING_MAX_AGE_MS
  );
  if (inFlight !== undefined) return { kind: "move_in_flight", emailId: inFlight.id };

  const matchedElsewhere = sorted.find((copy) => {
    const where = matched.get(copy.id);
    return where !== undefined && where !== folder;
  });
  const seenElsewhere = matchedElsewhere !== undefined;
  const free = sorted.filter((copy) => !matched.has(copy.id));
  const here = free.find((copy) => copy.folder === folder);
  if (here !== undefined) return { kind: "update_uid", emailId: here.id, isSource: here.folder === here.sourceFolder };
  if (free.length > 0) {
    return {
      kind: "check_folder",
      candidates: free.slice(0, CHECK_FOLDER_MAX_CANDIDATES).map((copy) => ({
        emailId: copy.id,
        folder: copy.folder,
        systemMoved: copy.folder !== copy.sourceFolder,
      })),
      seenElsewhere,
    };
  }
  if (matchedElsewhere !== undefined) return { kind: "cross_copy", emailId: matchedElsewhere.id };
  return { kind: "new", dedupKey: copyDedupKey(input.baseKey, input.copies.length + 1) };
}

export type FolderCheckResult =
  | { kind: "returned"; emailId: string }
  | { kind: "relocated"; emailId: string }
  | { kind: "cross_copy"; emailId: string }
  | { kind: "new"; dedupKey: string };

/**
 * The known copy sits in another folder than S. A system-moved copy that is still there → an identical second
 * copy (`new`), or a `cross_copy` when this run saw the mail elsewhere; gone → the user moved it back (`returned`).
 * A copy in its source folder that is still there → `cross_copy`; gone → the user moved it (`relocated`).
 */
export function resolveFolderCheck(input: {
  emailId: string;
  stillInFolder: boolean;
  systemMoved: boolean;
  seenElsewhere: boolean;
  baseKey: string;
  copyCount: number;
}): FolderCheckResult {
  const { emailId } = input;
  if (input.systemMoved) {
    if (!input.stillInFolder) return { kind: "returned", emailId };
    if (input.seenElsewhere) return { kind: "cross_copy", emailId };
    return { kind: "new", dedupKey: copyDedupKey(input.baseKey, input.copyCount + 1) };
  }
  return input.stillInFolder ? { kind: "cross_copy", emailId } : { kind: "relocated", emailId };
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
 * D4: the metas of the `source_folder` of moved rows (stage 8), at the `inbox_uid` (the last known UID in the source
 * folder) and the `uid` of each row (a system move gives the mail a new folder UID; a webmail move back keeps it).
 * A meta that is not `\Deleted` and has the identity of the row at one of its UIDs is a mail that came back to its
 * source folder below the cursor.
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

/**
 * A user move of a known mail into a synced folder: the server keeps the UID (Interia has one UID counter per mailbox),
 * so a meta of that folder at the row's own `uid`, not `\Deleted`, with the identity of the row, is the row's mail.
 * Each row and each meta give at most one hit; for one meta the first matching row of `rows` wins.
 */
export function matchMoved(
  metas: readonly FolderMessageMeta[],
  rows: readonly MoveCandidateRow[],
  mode: IdentityMode = IDENTITY_MODE
): { emailId: string; uid: number }[] {
  const hits = new Map<string, { emailId: string; uid: number }>();
  for (const meta of metas) {
    if (isDeleted(meta)) continue;
    const row = rows.find(
      (candidate) =>
        !hits.has(candidate.id) &&
        candidate.uid === meta.uid &&
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
    if (row !== undefined) hits.set(row.id, { emailId: row.id, uid: meta.uid });
  }
  return [...hits.values()];
}
