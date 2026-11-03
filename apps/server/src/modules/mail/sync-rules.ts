import { createHash } from "node:crypto";

import { INBOX, type MessageMeta } from "./port";

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

export type FolderCheckResult = { kind: "returned"; emailId: string } | { kind: "new"; dedupKey: string };

/**
 * Still in its folder → a second identical copy (store and triage it).
 * Gone → the user moved it back (the caller sets `returned_at` and `folder = INBOX`).
 */
export function resolveFolderCheck(input: {
  emailId: string;
  stillInFolder: boolean;
  baseKey: string;
  copyCount: number;
}): FolderCheckResult {
  if (input.stillInFolder) {
    return { kind: "new", dedupKey: copyDedupKey(input.baseKey, input.copyCount + 1) };
  }
  return { kind: "returned", emailId: input.emailId };
}
