import { createHash } from "node:crypto";

import { draftCopyKey, type DraftCopy } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { locateByActionId, type FolderMessageMeta, type MailContent, type MailProvider } from "../mail";

import { getDraft, getDraftMailboxId } from "./repo";

// The edit check of a Drafts copy (ADR 0033, ticket F115-e6a-reply-drafts: the copy hash of every draft kind). The committer reads the copy right after its APPEND and keeps the
// hash of what a person can change (`draftCopyKey`: text, Subject, To, Cc, attachment list) in `provider_result.copy_hash`.
// Before a send, and before a delete, it reads the copy again and compares. The text itself is never stored. A copy that the
// server holds with another text, another address, another Subject or another attachment list is the user's edit.

/** The hash of the canonical key of a copy: 64 lower-case hex characters. */
export function draftCopyHash(copy: DraftCopy): string {
  return createHash("sha256").update(draftCopyKey(copy)).digest("hex");
}

export const COPY_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The stored baseline of a draft row, or null: no `copy_hash` (an older draft, or the read after the APPEND failed). */
export function baselineOf(providerResult: Readonly<Record<string, unknown>> | null): string | null {
  const hash = providerResult?.copy_hash;
  return typeof hash === "string" && COPY_HASH_PATTERN.test(hash) ? hash : null;
}

/** What the server holds: the header meta and the content of one message. */
export function copyOf(meta: FolderMessageMeta, content: MailContent): DraftCopy {
  return {
    text: content.text,
    subject: meta.subject ?? "",
    to: meta.to,
    cc: meta.cc,
    attachmentCount: content.capture?.attachmentCount ?? 0,
    attachments: (content.capture?.attachments ?? []).map(({ name, type, size }) => ({ name, type, size })),
  };
}

export interface CopyKey {
  /** The `X-EA-Action-Id` of the copy = the id of the draft row. */
  actionId: string;
  /** `provider_result.uid` of the APPEND, when known. */
  hintUid: number | null;
  /** The draft's `created_at` (the search window starts a day earlier). */
  since: Date;
}

export type CopyRead = { kind: "found"; uid: number; copy: DraftCopy } | { kind: "missing" };

/**
 * Finds the copy by its action id (the hint UID first) and reads it once: `fetchMetaIn` or the search for Subject, To and Cc,
 * `fetchContent` for the text and the attachment capture. Nothing here writes to the mailbox. An IMAP error is thrown.
 */
export async function readDraftCopy(provider: MailProvider, folder: string, key: CopyKey): Promise<CopyRead> {
  const meta = await locateByActionId(provider, folder, key);
  if (meta === null) return { kind: "missing" };
  const content = await provider.fetchContent(folder, meta.uid);
  return { kind: "found", uid: meta.uid, copy: copyOf(meta, content) };
}

export type CopyCheck = "same" | "changed" | "missing" | "no_baseline";

/**
 * Pure. `missing`: no copy in the folder. `no_baseline`: the draft has no `copy_hash` to compare with. `changed`: the text
 * cannot be read, or the hash differs. `same`: the hash is equal.
 */
export function judgeCopy(read: CopyRead, baseline: string | null): CopyCheck {
  if (read.kind === "missing") return "missing";
  if (baseline === null) return "no_baseline";
  // A copy whose text cannot be read counts as changed: two unreadable copies must never look equal.
  if (read.copy.text === null) return "changed";
  return draftCopyHash(read.copy) === baseline ? "same" : "changed";
}

export type CheckDraftCopyResult = { kind: "checked"; result: CopyCheck } | { kind: "not_found" };

/**
 * The service of `bun run reply:check-copy`: the check of one draft of this organization against its Drafts copy. It opens
 * the mailbox, reads, compares and writes nothing. An id of another organization or of no draft answers `not_found`.
 */
export async function checkDraftCopy(
  deps: {
    db: Db | Transaction<DB>;
    /** Opens the mailbox with the credentials, and the token store of an OAuth mailbox, that the composition root holds. */
    openProvider(ctx: TenantContext, mailboxId: string): Promise<MailProvider>;
  },
  ctx: TenantContext,
  draftId: string
): Promise<CheckDraftCopyResult> {
  const draft = await getDraft(deps.db, ctx, draftId);
  const mailboxId = draft === undefined ? undefined : await getDraftMailboxId(deps.db, ctx, draftId);
  if (draft === undefined || mailboxId === undefined) return { kind: "not_found" };
  const folder = draft.provider_result?.folder;
  const uid = draft.provider_result?.uid;
  // A draft that was never APPENDed has no copy to look for.
  if (typeof folder !== "string") return { kind: "checked", result: "missing" };
  const provider = await deps.openProvider(ctx, mailboxId);
  try {
    const read = await readDraftCopy(provider, folder, {
      actionId: draft.id,
      hintUid: typeof uid === "number" ? uid : null,
      since: draft.created_at,
    });
    return { kind: "checked", result: judgeCopy(read, baselineOf(draft.provider_result)) };
  } finally {
    await provider.close().catch(() => undefined);
  }
}
