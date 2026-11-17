import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { getOrganization, isFeatureOn } from "../tenancy";

import { MailboxNotFoundError, MailFolderMissingError, type MessageMeta, type SentFolderReader } from "./port";
import {
  getMailbox,
  getSentSyncState,
  insertSentEmails,
  lockSentSyncState,
  markSentPass,
  resetSentCursor,
  updateSentCursor,
  type NewSentEmail,
  type SentSyncState,
} from "./repo";
import { budgetedReader, SentBudgetError, startDeadline, type SentBudgetDeps, type SentDeadline } from "./sent-budget";
import {
  firstPerDedupKey,
  sentModeOf,
  sentTextWindowMs,
  SENT_CHUNK_SIZE,
  SENT_HEADER_WINDOW_MS,
  SENT_PASS_BUDGET_MS,
  toNewSentEmail,
  type SentMode,
  type SentOrigin,
} from "./sent-rules";
import { fetchSentTexts, type SentTextResult } from "./sent-texts";
import { fetchSince } from "./sync";
import { filterAboveCursor } from "./sync-rules";

// The Sent read: the header pass, then the text step (`sent-texts.ts`). It takes a `SentFolderReader`: the type has no write method, so the pass cannot change the folder.
// It writes no log line, and an error text holds no path, subject or address.

export interface SentSyncDeps extends SentBudgetDeps {
  db: Db | Transaction<DB>;
  provider: SentFolderReader;
  /** Injected: `mail` may not import `actions`. */
  sentOriginOf(ctx: TenantContext, mailboxId: string, actionId: string): Promise<SentOrigin>;
  now(): Date;
  chunkSize?: number;
}

// `budget`: the time budget of the pass was used up (`sent-budget.ts`). The rows written so far stay; the next pass goes on. It is not an error.

export type SentPassStatus = "flag_off" | "off" | "no_folder" | "folder_missing" | "cursor_moved" | "budget" | "done";

export interface SentHeaderResult {
  status: SentPassStatus;
  /** Null when the pass ended before it chose a mode. */
  mode: SentMode | null;
  /** Metas that the pass took from the folder (above the cursor, or inside the header window). */
  fetched: number;
  /** New rows. A mail that exists already, and one with a tombstone, do not count. */
  stored: number;
  /** Rows of the system's own sends in the chunks that the pass wrote. */
  system: number;
  /** Metas older than the header window that arrived above the cursor. */
  tooOld: number;
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  return a === null || b === null ? a === b : a.getTime() === b.getTime();
}

// The state that the pass read is still the state of the row (the switch, the period, the folder and the cursor).
function stateUnchanged(locked: SentSyncState | undefined, expected: SentSyncState): locked is SentSyncState {
  return (
    locked !== undefined &&
    locked.enabled &&
    sameInstant(locked.enabledAt, expected.enabledAt) &&
    locked.path === expected.path &&
    locked.uidValidity === expected.uidValidity &&
    locked.lastUid === expected.lastUid
  );
}

// One transaction: lock the state row, compare it with `expected`, then write. A mismatch writes nothing and returns false.
async function writeGuarded(
  deps: SentSyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  expected: SentSyncState,
  write: (trx: Transaction<DB>) => Promise<void>
): Promise<boolean> {
  const run = async (trx: Transaction<DB>): Promise<boolean> => {
    if (!stateUnchanged(await lockSentSyncState(trx, ctx, mailboxId), expected)) return false;
    await write(trx);
    return true;
  };
  return deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run);
}

export async function syncSentHeaders(
  deps: SentSyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  deadline: SentDeadline = startDeadline(deps, SENT_PASS_BUDGET_MS)
): Promise<SentHeaderResult> {
  const now = deps.now();
  const result: SentHeaderResult = { status: "done", mode: null, fetched: 0, stored: 0, system: 0, tooOld: 0 };
  const finish = async (status: SentPassStatus, errorCode: "no_folder" | "folder_missing" | null) => {
    await markSentPass(deps.db, ctx, mailboxId, { at: now, errorCode });
    return { ...result, status };
  };

  if (!(await isFeatureOn(deps.db, ctx, "sent_sync"))) return { ...result, status: "flag_off" };
  let state = await getSentSyncState(deps.db, ctx, mailboxId);
  if (state === undefined || !state.enabled) return { ...result, status: "off" };

  const mailbox = await getMailbox(deps.db, ctx, mailboxId);
  if (mailbox === undefined) throw new MailboxNotFoundError();
  const path = mailbox.folder_map.sent;
  if (typeof path !== "string" || path === "") return finish("no_folder", "no_folder");

  if (state.path !== path) {
    const expected = state;
    const reset = await writeGuarded(deps, ctx, mailboxId, expected, async (trx) => {
      await resetSentCursor(trx, ctx, mailboxId, { path });
    });
    if (!reset) return finish("cursor_moved", null);
    state = await getSentSyncState(deps.db, ctx, mailboxId);
    // Another run changed the switch or the folder between the reset and this read: write nothing.
    if (state === undefined || !state.enabled || state.path !== path) return finish("cursor_moved", null);
  }

  const organization = await getOrganization(deps.db, ctx);
  if (organization === undefined) throw new HardError("organization not found");
  const textWindowMs = sentTextWindowMs(organization.data_retention_days);
  const chunkSize = deps.chunkSize ?? SENT_CHUNK_SIZE;

  const reader = budgetedReader(deps.provider, deadline);
  try {
    const status = await reader.folderStatus(path);
    const mode = sentModeOf(state, status);
    result.mode = mode;

    let kept: MessageMeta[];
    if (mode === "incremental") {
      kept = filterAboveCursor(await reader.fetchAbove(path, state.lastUid ?? 0), state.lastUid ?? 0).kept;
    } else {
      kept = await fetchSince(reader, path, new Date(now.getTime() - SENT_HEADER_WINDOW_MS));
    }
    result.fetched = kept.length;

    // The state of the last write: the guard of the next write compares with it.
    let expected: SentSyncState = state;
    const seen = new Set<string>();
    for (let offset = 0; offset < kept.length; offset += chunkSize) {
      deadline.check();
      const chunk = kept.slice(offset, offset + chunkSize);
      const planned: NewSentEmail[] = [];
      for (const meta of chunk) {
        const origin = meta.actionId === null ? null : await deps.sentOriginOf(ctx, mailboxId, meta.actionId);
        const row = toNewSentEmail(meta, {
          mailboxId,
          path,
          uidValidity: status.uidValidity,
          now,
          textWindowMs,
          origin,
        });
        if (row === null) result.tooOld += 1;
        else planned.push(row);
      }
      const rows = firstPerDedupKey(planned).filter((row) => !seen.has(row.dedupKey));
      const lastUid = chunk[chunk.length - 1]?.uid ?? 0;
      if (mode !== "incremental" && rows.length === 0) continue;

      let stored = 0;
      const written = await writeGuarded(deps, ctx, mailboxId, expected, async (trx) => {
        stored = await insertSentEmails(trx, ctx, rows);
        if (mode === "incremental") {
          await updateSentCursor(trx, ctx, mailboxId, { uidValidity: status.uidValidity, lastUid });
        }
      });
      if (!written) return finish("cursor_moved", null);
      for (const row of rows) seen.add(row.dedupKey);
      result.stored += stored;
      result.system += rows.filter((row) => row.origin === "system").length;
      if (mode === "incremental") expected = { ...expected, lastUid };
    }

    if (mode !== "incremental") {
      const highest = kept[kept.length - 1]?.uid ?? 0;
      const cursor = { uidValidity: status.uidValidity, lastUid: Math.max(status.uidNext - 1, highest) };
      const moved = await writeGuarded(deps, ctx, mailboxId, expected, async (trx) => {
        await updateSentCursor(trx, ctx, mailboxId, cursor, { firstPassAt: now });
      });
      if (!moved) return finish("cursor_moved", null);
    }
  } catch (error) {
    if (error instanceof SentBudgetError) return finish("budget", null);
    if (error instanceof MailFolderMissingError) return finish("folder_missing", "folder_missing");
    throw error;
  }
  return finish("done", null);
}

export interface SentPassResult extends SentHeaderResult {
  texts: SentTextResult;
}

// The header step, then (when it ended `done`) the text step for the folder and numbering that the header step left in the state row.
// The header step has released its locks before the first mail server call of the text step.
export async function syncSentFolder(
  deps: SentSyncDeps,
  ctx: TenantContext,
  mailboxId: string
): Promise<SentPassResult> {
  const deadline = startDeadline(deps, SENT_PASS_BUDGET_MS);
  const header = await syncSentHeaders(deps, ctx, mailboxId, deadline);
  const texts: SentTextResult = { stored: 0, gone: 0, expired: 0 };
  if (header.status !== "done") return { ...header, texts };

  const state = await getSentSyncState(deps.db, ctx, mailboxId);
  if (state === undefined || !state.enabled || state.path === null || state.uidValidity === null) {
    return { ...header, texts };
  }
  const organization = await getOrganization(deps.db, ctx);
  if (organization === undefined) throw new HardError("organization not found");
  const done = await fetchSentTexts(deps, ctx, mailboxId, {
    path: state.path,
    uidValidity: state.uidValidity,
    textWindowMs: sentTextWindowMs(organization.data_retention_days),
    deadline,
  });
  // The text step ran out of time: the pass status is `budget`, the rest of the pending rows wait for the next pass.
  return { ...header, status: done.budget === true ? "budget" : header.status, texts: done };
}
