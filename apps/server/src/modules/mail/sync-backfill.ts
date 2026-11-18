import { DAY_MS } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError, SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { isOrgSuspended } from "../tenancy";

import { INBOX } from "./port";
import { getMailbox, getSyncFolder, type Cursor, type SyncFolderRow } from "./repo";
import { fetchSince } from "./sync";
import { applyChunk, planChunk } from "./sync-chunk";
import { DEFAULT_CHUNK_SIZE, emptyResult, type RunState, type SyncDeps, type SyncResult } from "./sync-run";

const log = createLog("mail");

// Pilot exception (user, 2026-11-06): the backfill may go back 180 days, past the 30-day body retention (architecture §7).
const BACKFILL_MAX_MS = 180 * DAY_MS;

/** The `emails.skip_reason` of mail that the history check stored. The triage worker never claims it. */
export const HISTORY_SKIP_REASON = "history_check";

async function readInboxFolder(deps: SyncDeps, ctx: TenantContext, mailboxId: string): Promise<SyncFolderRow> {
  const folder = await getSyncFolder(deps.db, ctx, mailboxId, "inbox");
  if (!folder) throw new HardError("mailbox has no INBOX folder row");
  return folder;
}

/** Why a history backfill did not run. A code, never a text: the history check job maps it to `no_result_reason`. */
export type BackfillRefusal =
  | "window_too_long"
  | "org_suspended"
  | "never_synced"
  | "uidvalidity_changed"
  | "auth_refused";

/** The result of the `history` purpose: the refusals that a `backfill` run throws come back as a value. */
export type HistoryBackfillOutcome =
  | { kind: "done"; result: SyncResult }
  | { kind: "refused"; reason: BackfillRefusal };

export type BackfillPurpose = "backfill" | "history";

/**
 * The refusals that need no provider call, in the order of the checks: the window, the organization, the first sync.
 * `backfillInbox` and `backfillMailbox` both ask it, so a refused run opens no connection.
 */
export async function historyRefusalBeforeOpen(
  db: Db | Transaction<DB>,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date; now: Date }
): Promise<BackfillRefusal | null> {
  if (opts.since.getTime() < opts.now.getTime() - BACKFILL_MAX_MS) return "window_too_long";
  if (!(await getMailbox(db, ctx, mailboxId))) throw new HardError(`mailbox ${mailboxId} not found`);
  if (await isOrgSuspended(db, ctx)) return "org_suspended";
  const folder = await getSyncFolder(db, ctx, mailboxId, "inbox");
  if (folder === undefined) throw new HardError("mailbox has no INBOX folder row");
  if (folder.uidvalidity === null) return "never_synced";
  return null;
}

/**
 * One-off, read-only fetch of older INBOX mail from `opts.since` on. Stores the missing mails with
 * `backfilled_at` and never moves the cursor.
 *
 * `purpose` `backfill` (the default, the operator CLI): the mail is `pending` and a refusal throws.
 * `purpose` `history` (the history check of the trust ladder): a new mail is stored `skipped` with the reason `history_check`, so the triage worker
 * never claims it and no digest, notice or action follows. Only inserts are written: a mail that exists (any status) is not changed.
 * A refusal (window over 180 days, suspended organization, never synced, UIDVALIDITY change) comes back as a value.
 */
export async function backfillInbox(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date; purpose?: "backfill" }
): Promise<SyncResult>;

export async function backfillInbox(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date; purpose: "history" }
): Promise<HistoryBackfillOutcome>;

export async function backfillInbox(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  opts: { since: Date; purpose?: BackfillPurpose }
): Promise<SyncResult | HistoryBackfillOutcome> {
  const history = opts.purpose === "history";
  if (history) {
    const reason = await historyRefusalBeforeOpen(deps.db, ctx, mailboxId, { since: opts.since, now: deps.now() });
    if (reason !== null) return { kind: "refused", reason };
  } else if (opts.since.getTime() < deps.now().getTime() - BACKFILL_MAX_MS) {
    throw new HardError("backfill since is more than 180 days back");
  }
  const mailbox = await getMailbox(deps.db, ctx, mailboxId);
  if (!mailbox) throw new HardError(`mailbox ${mailboxId} not found`);
  const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
  const folder = await readInboxFolder(deps, ctx, mailboxId);
  if (folder.uidvalidity === null) throw new HardError("mailbox was never synced: run the sync first");

  const status = await deps.provider.folderStatus(INBOX);
  if (status.uidValidity !== folder.uidvalidity) {
    if (history) return { kind: "refused", reason: "uidvalidity_changed" };
    throw new SoftError("UIDVALIDITY changed: wait for the regular sync to rescan, then run the backfill again");
  }

  const fetched = await fetchSince(deps.provider, INBOX, opts.since);
  // The history check keeps only mail at or below the cursor, the mail of before the connect. Mail above it is live mail: the regular
  // sync stores it `pending` and triages it, and it would find a history row there and only update its UID.
  const kept = history ? fetched.filter((meta) => meta.uid <= (folder.last_uid ?? 0)) : fetched;
  const result: SyncResult = { ...emptyResult("inbox", "backfill"), fetched: kept.length };

  const chunkSize = deps.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const state: RunState = { matched: new Map(), newKeys: new Map() };
  const start: Cursor = { uidValidity: folder.uidvalidity, lastUid: folder.last_uid };
  for (let offset = 0; offset < kept.length; offset += chunkSize) {
    const chunk = kept.slice(offset, offset + chunkSize);
    const planned = await planChunk(deps, ctx, mailboxId, INBOX, chunk, state, result);
    // The history check changes no stored row: an `update_uid`, `returned` or `relocated` write would touch a mail that sync owns.
    const writes = history ? planned.filter((write) => write.kind === "insert") : planned;
    const backfilledAt = deps.now();
    for (const write of writes) {
      if (write.kind !== "insert") continue;
      write.row.backfilled_at = backfilledAt;
      if (history) {
        write.row.status = "skipped";
        write.row.skip_reason = HISTORY_SKIP_REASON;
      }
    }
    // `next` is null: the cursor never moves.
    await applyChunk(deps, ctx, mailboxId, folder.id, writes, start, null, result);
  }

  mailboxLog.info("backfill_done", {
    fetched: result.fetched,
    stored: result.stored,
    uid_updated: result.uidUpdated,
    returned: result.returned,
    skipped_own: result.skippedOwn,
  });
  if (result.captureMissing > 0) {
    mailboxLog.warn("capture_missing", { count: result.captureMissing });
  }
  return history ? { kind: "done", result } : result;
}
