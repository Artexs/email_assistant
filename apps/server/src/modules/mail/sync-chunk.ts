import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { HardError } from "../../platform/errors";
import { createLog, type Log } from "../../platform/log";

import { storeCapture } from "./capture-store";
import { locateMessage, type LocateKey } from "./locate";
import type { CapturedHeaders, MessageMeta } from "./port";
import {
  findCopies,
  insertEmail,
  lockSyncFolder,
  markEmailRelocated,
  markEmailReturned,
  updateEmailUid,
  updateFolderCursor,
  type Cursor,
  type InsertableEmail,
} from "./repo";
import {
  baseDedupKey,
  contentHash,
  decideIncoming,
  normalizeMessageId,
  otherCopyUids,
  resolveFolderCheck,
  type FolderCheckResult,
  type IncomingDecision,
  type KnownCopy,
} from "./sync-rules";
import { CursorMovedError, newRow, withRunCopies, type RunState, type SyncDeps, type SyncResult } from "./sync-run";

const log = createLog("mail");

type Write =
  | { kind: "insert"; row: InsertableEmail; capture: CapturedHeaders | null }
  | { kind: "update_uid"; emailId: string; uid: number; folder: string; isSource: boolean }
  | { kind: "returned"; emailId: string; uid: number; folder: string }
  | { kind: "relocated"; emailId: string; uid: number; from: string; to: string };

// D7: one mail in two synced folders is stored once. It sets no `matched` entry (a rescan would turn the row's own pass into a cross copy).
function countCrossCopy(mailboxLog: Log, result: SyncResult, emailId: string): void {
  result.crossCopies += 1;
  mailboxLog.debug("sync_cross_copy", { folder_key: result.folder, email_id: emailId });
}

// The free copies outside S, in copy order: the first one that is gone is the mail the user moved into S.
// With none gone, the first copy decides as before (an identical new copy, or a cross copy).
async function checkFolders(
  deps: SyncDeps,
  decision: Extract<IncomingDecision, { kind: "check_folder" }>,
  copies: KnownCopy[],
  messageId: string | null,
  baseKey: string
): Promise<{ check: FolderCheckResult; copy: KnownCopy }> {
  let first: { check: FolderCheckResult; copy: KnownCopy } | null = null;
  for (const candidate of decision.candidates) {
    const copy = copies.find((known) => known.id === candidate.emailId);
    if (copy === undefined) throw new HardError("matched copy is missing");
    const key: LocateKey = {
      messageId,
      contentHash: copy.contentHash,
      from: copy.from,
      receivedAt: copy.receivedAt,
      hintUid: copy.uid,
    };
    const excludeUids = otherCopyUids(copies, copy.id, candidate.folder);
    const stillInFolder = (await locateMessage(deps.provider, candidate.folder, key, { excludeUids })) !== null;
    const check = resolveFolderCheck({
      emailId: candidate.emailId,
      stillInFolder,
      systemMoved: candidate.systemMoved,
      seenElsewhere: decision.seenElsewhere,
      baseKey,
      copyCount: copies.length,
    });
    if (!stillInFolder) return { check, copy };
    first ??= { check, copy };
  }
  if (first === null) throw new HardError("check_folder without candidates");
  return first;
}

// Phase 1: provider calls and DB reads only.
export async function planChunk(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  folder: string,
  chunk: MessageMeta[],
  state: RunState,
  result: SyncResult
): Promise<Write[]> {
  const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
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
    const runStored = state.newKeys.get(baseKey) ?? [];
    const fromDb = await findCopies(deps.db, ctx, mailboxId, { messageId, contentHash: hash });
    const copies = withRunCopies(fromDb, runStored, meta, hash);

    const decision = decideIncoming({ folder, baseKey, copies, matched: state.matched, now: deps.now() });
    let dedupKey: string | null = null;
    if (decision.kind === "move_in_flight") {
      result.moveInFlight += 1;
      mailboxLog.debug("sync_move_target_copy", { email_id: decision.emailId });
    } else if (decision.kind === "update_uid") {
      state.matched.set(decision.emailId, folder);
      writes.push({
        kind: "update_uid",
        emailId: decision.emailId,
        uid: meta.uid,
        folder,
        isSource: decision.isSource,
      });
    } else if (decision.kind === "cross_copy") {
      countCrossCopy(mailboxLog, result, decision.emailId);
    } else if (decision.kind === "check_folder") {
      const { check, copy } = await checkFolders(deps, decision, copies, messageId, baseKey);
      if (check.kind === "cross_copy") {
        countCrossCopy(mailboxLog, result, check.emailId);
      } else {
        state.matched.set(copy.id, folder);
        if (check.kind === "returned") {
          writes.push({ kind: "returned", emailId: check.emailId, uid: meta.uid, folder });
        } else if (check.kind === "relocated") {
          writes.push({ kind: "relocated", emailId: check.emailId, uid: meta.uid, from: copy.folder, to: folder });
        } else {
          dedupKey = check.dedupKey;
        }
      }
    } else {
      dedupKey = decision.dedupKey;
    }

    if (dedupKey !== null) {
      const content = await deps.provider.fetchContent(folder, meta.uid);
      writes.push({
        kind: "insert",
        row: newRow(mailboxId, folder, meta, messageId, hash, dedupKey, content.text),
        capture: content.capture,
      });
      state.newKeys.set(baseKey, [...runStored, { dedupKey, folder, uid: meta.uid }]);
      state.matched.set(`run:${dedupKey}`, folder);
    }
  }
  return writes;
}

// Phase 2: one transaction that applies the chunk. `next` moves the cursor with it; `null` keeps it.
export async function applyChunk(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  folderId: string,
  writes: Write[],
  expected: Cursor,
  next: Cursor | null,
  result: SyncResult
): Promise<void> {
  const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
  const run = async (trx: Transaction<DB>) => {
    const folder = await lockSyncFolder(trx, ctx, folderId);
    if (folder?.uidvalidity !== expected.uidValidity || folder.last_uid !== expected.lastUid) {
      throw new CursorMovedError(`cursor of mailbox ${mailboxId} moved during the sync`);
    }
    let stored = 0;
    let missing = 0;
    let uidUpdated = 0;
    let returned = 0;
    let relocated = 0;
    for (const write of writes) {
      if (write.kind === "insert") {
        if (await insertEmail(trx, ctx, write.row)) {
          stored += 1;
          const mail = { mailboxId: write.row.mailbox_id, dedupKey: write.row.dedup_key };
          if (write.capture === null || !(await storeCapture(trx, ctx, mail, write.capture, deps.now()))) missing += 1;
        }
      } else if (write.kind === "update_uid") {
        if (
          await updateEmailUid(trx, ctx, write.emailId, write.uid, { folder: write.folder, isSource: write.isSource })
        ) {
          uidUpdated += 1;
        } else {
          mailboxLog.debug("sync_uid_update_no_row", { email_id: write.emailId });
        }
      } else if (write.kind === "returned") {
        if (await markEmailReturned(trx, ctx, write.emailId, write.uid, deps.now(), { folder: write.folder })) {
          returned += 1;
        } else {
          mailboxLog.debug("sync_return_no_row", { email_id: write.emailId });
        }
      } else if (
        await markEmailRelocated(trx, ctx, write.emailId, { from: write.from, to: write.to, uid: write.uid })
      ) {
        relocated += 1;
      } else {
        mailboxLog.debug("sync_move_no_row", { email_id: write.emailId });
      }
    }
    if (next !== null && !(await updateFolderCursor(trx, ctx, folderId, expected, next))) {
      throw new CursorMovedError(`cursor of mailbox ${mailboxId} moved during the sync`);
    }
    return { stored, missing, uidUpdated, returned, relocated };
  };

  const counts = deps.db.isTransaction
    ? await run(deps.db as Transaction<DB>)
    : await deps.db.transaction().execute(run);
  result.stored += counts.stored;
  result.captureMissing += counts.missing;
  result.uidUpdated += counts.uidUpdated;
  result.returned += counts.returned;
  result.relocated += counts.relocated;
}

// After the last chunk of an initial sync or a rescan: set the cursor in one more transaction.
export async function setCursor(
  deps: SyncDeps,
  ctx: TenantContext,
  mailboxId: string,
  folderId: string,
  expected: Cursor,
  next: Cursor
): Promise<void> {
  const run = async (trx: Transaction<DB>) => {
    if (!(await updateFolderCursor(trx, ctx, folderId, expected, next))) {
      throw new CursorMovedError(`cursor of mailbox ${mailboxId} moved during the sync`);
    }
  };
  await (deps.db.isTransaction ? run(deps.db as Transaction<DB>) : deps.db.transaction().execute(run));
}
