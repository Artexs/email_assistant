import { DAY_MS, MINUTE_MS } from "@ea/core";

import type { FolderStatus, MessageMeta } from "./port";
import type { NewSentEmail } from "./repo";
import { baseDedupKey, contentHash, normalizeMessageId, threadKey } from "./sync-rules";

// Pure rules of the Sent read (no database, no mail server).

/** Sent mail older than this (by INTERNALDATE) is not stored. */
export const SENT_HEADER_WINDOW_MS = 30 * DAY_MS;
/** Sent mail older than this gets no text. */
export const SENT_TEXT_WINDOW_MS = 14 * DAY_MS;
/** Metas per write transaction. */
export const SENT_CHUNK_SIZE = 50;
/** Texts read per run. */
export const SENT_TEXT_RUN_LIMIT = 100;
/** One Sent pass (headers and texts) stops after this time. It never holds the `mail.sync` run longer. */
export const SENT_PASS_BUDGET_MS = MINUTE_MS;

export type SentMode = "initial" | "incremental" | "rescan";
/** `system`: the system sent it. `draft`: the user sent a draft of the system by hand. null: no link to an action. */
export type SentOrigin = "system" | "draft" | null;

/** The text window: 14 days, or the retention of the organization when that is shorter. */
export function sentTextWindowMs(retentionDays: number): number {
  return Math.min(SENT_TEXT_WINDOW_MS, retentionDays * DAY_MS);
}

export function sentModeOf(cursor: { uidValidity: number | null } | null, status: FolderStatus): SentMode {
  if (cursor === null || cursor.uidValidity === null) return "initial";
  return cursor.uidValidity === status.uidValidity ? "incremental" : "rescan";
}

/** The parent of a sent mail: In-Reply-To, else the last References id. */
export function parentMessageId(meta: Pick<MessageMeta, "inReplyTo" | "references">): string | null {
  const reply = normalizeMessageId(meta.inReplyTo);
  if (reply !== null) return reply;
  for (let i = meta.references.length - 1; i >= 0; i -= 1) {
    const id = normalizeMessageId(meta.references[i]);
    if (id !== null) return id;
  }
  return null;
}

/** Trim, lower case, drop empty values and repeats. The order stays. */
export function cleanAddresses(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const address = raw.trim().toLowerCase();
    if (address === "" || seen.has(address)) continue;
    seen.add(address);
    out.push(address);
  }
  return out;
}

export interface SentRowContext {
  mailboxId: string;
  path: string;
  uidValidity: number;
  now: Date;
  textWindowMs: number;
  origin: SentOrigin;
}

/** The row for one mail of the Sent folder; null when the mail is older than the header window. */
export function toNewSentEmail(meta: MessageMeta, context: SentRowContext): NewSentEmail | null {
  const { now, origin } = context;
  const internalMs = meta.internalDate.getTime();
  if (internalMs < now.getTime() - SENT_HEADER_WINDOW_MS) return null;

  const messageId = normalizeMessageId(meta.messageId);
  const dedupKey = baseDedupKey(messageId, contentHash(meta));
  const dateValid = meta.date !== null && !Number.isNaN(meta.date.getTime());
  const headersOnly = origin === "system" || internalMs < now.getTime() - context.textWindowMs;
  const from = meta.from?.trim().toLowerCase() ?? "";
  return {
    mailboxId: context.mailboxId,
    dedupKey,
    path: context.path,
    uidValidity: context.uidValidity,
    uid: meta.uid,
    messageId,
    parentMessageId: parentMessageId(meta),
    referencesIds: meta.references,
    threadKey: threadKey({ ...meta, messageId }, dedupKey),
    fromAddress: from === "" ? null : from,
    toAddresses: cleanAddresses(meta.to),
    ccAddresses: cleanAddresses(meta.cc),
    subject: meta.subject,
    sentAt: dateValid && meta.date !== null ? meta.date : meta.internalDate,
    internalDate: meta.internalDate,
    origin: origin === "system" ? "system" : "user",
    actionId: origin === null ? null : meta.actionId,
    content: headersOnly ? "headers_only" : "pending",
  };
}

/** The first row of each dedup key, in order. */
export function firstPerDedupKey<T extends { dedupKey: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.dedupKey)) continue;
    seen.add(row.dedupKey);
    out.push(row);
  }
  return out;
}
