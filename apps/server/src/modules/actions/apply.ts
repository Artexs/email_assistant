import { isMoveTarget, type ActionType, type MoveTarget } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { describeError, SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";
import {
  INBOX,
  listFolderUids,
  locateKeyOf,
  locateMessage,
  MailAuthError,
  setUndoPending,
  updateEmailLocation,
  type FolderMessageMeta,
  type MailProvider,
} from "../mail";

import { inTransaction, needsImap, type ApplyDeps, type ApplyHandler, type ApplyOutcome } from "./apply-shared";
import { HARD_ERROR_TRIES, RETRY_WAIT_MS } from "./constants";
import { applyDraft, removeDraft } from "./drafts";
import { ensureMoved, type EnsureResult } from "./move";
import { finishAction, markUndone, releaseAction, type ClaimedAction } from "./repo";
import { applySend } from "./send";

const log = createLog("actions");

export { HARD_ERROR_TRIES, RETRY_WAIT_MS };
export type { ApplyDeps, ApplyOutcome, FolderResolver, ResolvableFolderKey } from "./apply-shared";

const FLAG_OF_TYPE: Record<string, string> = { flag: "\\Flagged", mark_read: "\\Seen" };

// D9: a reverse move or a rescue (forward target `inbox`) that ends (applied or failed) clears the in-flight flag of the mail.
async function clearMovePending(trx: Transaction<DB>, ctx: TenantContext, action: ClaimedAction): Promise<void> {
  if (action.type === "move" && (action.reverses_action_id !== null || action.payload.folder === "inbox")) {
    await setUndoPending(trx, ctx, action.email_id, null);
  }
}

async function applySummary(deps: ApplyDeps, ctx: TenantContext, action: ClaimedAction): Promise<ApplyOutcome> {
  const now = deps.now();
  const done = await inTransaction(deps.db, async (trx) => {
    if (!(await finishAction(trx, ctx, action.id, action.locked_at, { status: "applied", at: now }))) {
      return false;
    }
    await recordAudit(trx, ctx, {
      emailId: action.email_id,
      actionId: action.id,
      actor: "system",
      event: auditEvents.actionApplied,
      data: { action_type: action.type, mailbox_id: deps.mailboxId, reverse: false },
    });
    return true;
  });
  if (!done) return { kind: "lost" };
  log.debug(`action ${action.id}: applied ${action.type}`);
  return { kind: "applied" };
}

// MailAuthError first: it is a HardError too.
async function mapProviderError(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  error: unknown
): Promise<ApplyOutcome> {
  if (error instanceof MailAuthError) {
    return { kind: "auth_error" };
  }
  const now = deps.now();
  const label = describeError(error);
  if (error instanceof SoftError) {
    log.warn(`action ${action.id}: ${label}, try ${action.attempts + 1} of ${HARD_ERROR_TRIES}`);
    await releaseAction(deps.db, ctx, action.id, action.locked_at, {
      toStatus: "ready",
      nextAttemptAt: new Date(now.getTime() + RETRY_WAIT_MS),
      countAttempt: false,
      now,
      lastError: label,
    });
    return { kind: "retry", soft: true };
  }
  if (action.attempts + 1 >= HARD_ERROR_TRIES) {
    const done = await inTransaction(deps.db, async (trx) => {
      if (
        !(await finishAction(trx, ctx, action.id, action.locked_at, {
          status: "failed",
          at: now,
          reason: "hard_error",
          lastError: label,
          countAttempt: true,
        }))
      ) {
        return false;
      }
      await clearMovePending(trx, ctx, action);
      await recordAudit(trx, ctx, {
        emailId: action.email_id,
        actionId: action.id,
        actor: "system",
        event: auditEvents.actionFailed,
        reasonCode: "hard_error",
        data: { attempts: action.attempts + 1, error: label },
      });
      return true;
    });
    if (!done) return { kind: "lost" };
    log.warn(`action ${action.id}: failed hard_error`);
    return { kind: "failed", reason: "hard_error" };
  }
  log.warn(`action ${action.id}: ${label}, try ${action.attempts + 1} of ${HARD_ERROR_TRIES}`);
  await releaseAction(deps.db, ctx, action.id, action.locked_at, {
    toStatus: "ready",
    nextAttemptAt: new Date(now.getTime() + RETRY_WAIT_MS),
    countAttempt: true,
    now,
    lastError: label,
  });
  return { kind: "retry", soft: false };
}

async function failAction(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  reason: "mail_not_found" | "bad_payload"
): Promise<ApplyOutcome> {
  const now = deps.now();
  const done = await inTransaction(deps.db, async (trx) => {
    if (
      !(await finishAction(trx, ctx, action.id, action.locked_at, {
        status: "failed",
        at: now,
        reason,
      }))
    ) {
      return false;
    }
    await clearMovePending(trx, ctx, action);
    await recordAudit(trx, ctx, {
      emailId: action.email_id,
      actionId: action.id,
      actor: "system",
      event: auditEvents.actionFailed,
      reasonCode: reason,
      data: {
        action_type: action.type,
        mailbox_id: deps.mailboxId,
        reverse: action.reverses_action_id !== null,
      },
    });
    return true;
  });
  if (!done) return { kind: "lost" };
  log.warn(`action ${action.id}: failed ${reason}`);
  return { kind: "failed", reason };
}

async function applyFlag(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  provider: MailProvider
): Promise<ApplyOutcome> {
  const { email } = action;
  const flag = FLAG_OF_TYPE[action.type] as string;
  const reverseOf = action.reverses_action_id;
  const excludeUids = await listFolderUids(deps.db, ctx, deps.mailboxId, email.folder, {
    exceptEmailId: email.id,
    messageId: email.message_id_header,
    contentHash: email.content_hash,
  });

  let meta: FolderMessageMeta | null;
  try {
    meta = await locateMessage(provider, email.folder, locateKeyOf(email, email.uid), { excludeUids });
    if (meta !== null) {
      await provider.setFlags(email.folder, meta.uid, reverseOf === null ? { add: [flag] } : { remove: [flag] });
    }
  } catch (error) {
    return mapProviderError(deps, ctx, action, error);
  }
  if (meta === null) {
    return failAction(deps, ctx, action, "mail_not_found");
  }

  const uid = meta.uid;
  const now = deps.now();
  const done = await inTransaction(deps.db, async (trx) => {
    if (
      !(await finishAction(trx, ctx, action.id, action.locked_at, {
        status: "applied",
        at: now,
        providerResult: { uid },
      }))
    ) {
      return false;
    }
    // Lock order: the original before `emails`, as in undo and processReturned.
    const undone = reverseOf !== null && (await markUndone(trx, ctx, reverseOf, { at: now, reason: "undo" }));
    if (uid !== email.uid) {
      await updateEmailLocation(trx, ctx, email.id, {
        folder: email.folder,
        uid,
        ...(email.folder === email.source_folder ? { sourceUid: uid } : {}),
      });
    }
    await recordAudit(trx, ctx, {
      emailId: email.id,
      actionId: action.id,
      actor: "system",
      event: auditEvents.actionApplied,
      data: { action_type: action.type, mailbox_id: deps.mailboxId, reverse: reverseOf !== null },
    });
    if (undone && reverseOf !== null) {
      await recordAudit(trx, ctx, {
        emailId: email.id,
        actionId: reverseOf,
        actor: "system",
        event: auditEvents.actionUndone,
        data: { reverse_action_id: action.id },
      });
    }
    return true;
  });
  if (!done) return { kind: "lost" };
  log.debug(`action ${action.id}: applied ${action.type}`);
  return { kind: "applied" };
}

// A move (D5): the ensure puts the mail in the target whatever happened before.
// A reverse brings it back to its source folder (D10); a forward move to `inbox` is the rescue (D12).
async function applyMove(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  provider: MailProvider
): Promise<ApplyOutcome> {
  const { email } = action;
  const reverseOf = action.reverses_action_id;
  const folderKey = isMoveTarget(action.payload.folder) ? action.payload.folder : undefined;
  if (reverseOf === null && folderKey === undefined) {
    return failAction(deps, ctx, action, "bad_payload");
  }
  const rescue = reverseOf === null && folderKey === "inbox";

  let to = email.source_folder;
  try {
    if (reverseOf === null) to = await deps.folders.resolve(folderKey as MoveTarget);
  } catch (error) {
    return mapProviderError(deps, ctx, action, error);
  }
  // D9: the sync must not store an INBOX copy of the mail while the rescue runs. Idempotent: each try sets it again.
  if (rescue) await setUndoPending(deps.db, ctx, email.id, deps.now());
  // When the sync marked the mail returned, `from` is the source folder too and the ensure only locates (rule 1).
  const from = email.folder;
  const hints = { fromUid: email.uid, toUid: reverseOf === null ? email.uid : email.inbox_uid };
  const byAppend = (to === INBOX && email.source_folder !== INBOX) || deps.appendFolders.has(to);
  const keyOf = { exceptEmailId: email.id, messageId: email.message_id_header, contentHash: email.content_hash };
  const exclude = {
    from: await listFolderUids(deps.db, ctx, deps.mailboxId, from, keyOf),
    to: await listFolderUids(deps.db, ctx, deps.mailboxId, to, keyOf),
  };

  let ensured: EnsureResult | null;
  try {
    ensured = await ensureMoved(provider, email, from, to, hints, exclude, { byAppend });
  } catch (error) {
    return mapProviderError(deps, ctx, action, error);
  }
  if (ensured === null) {
    return failAction(deps, ctx, action, "mail_not_found");
  }

  deps.beforeCommit?.();
  const { uid, movedNow, leftoverDeleted } = ensured;
  const now = deps.now();
  const done = await inTransaction(deps.db, async (trx) => {
    if (
      !(await finishAction(trx, ctx, action.id, action.locked_at, {
        status: "applied",
        at: now,
        providerResult: { uid, moved_now: movedNow, leftover_deleted: leftoverDeleted, by_append: byAppend },
      }))
    ) {
      return false;
    }
    // Lock order: the original before `emails`, as in undo and processReturned.
    // `markUndone` false: the original is `undone` (user_moved_back) already. Not an error.
    const undone = reverseOf !== null && (await markUndone(trx, ctx, reverseOf, { at: now, reason: "undo" }));
    await updateEmailLocation(trx, ctx, email.id, {
      folder: to,
      uid,
      ...(to === email.source_folder ? { sourceUid: uid, movedAt: null } : { movedAt: now }),
      ...(reverseOf === null && !rescue ? {} : { undoPendingAt: null }),
    });
    await recordAudit(trx, ctx, {
      emailId: email.id,
      actionId: action.id,
      actor: "system",
      event: auditEvents.actionApplied,
      data: {
        action_type: "move",
        mailbox_id: deps.mailboxId,
        // The payload of a reverse is the original's (D10).
        ...(folderKey === undefined ? {} : { folder_key: folderKey }),
        reverse: reverseOf !== null,
        moved_now: movedNow,
        leftover_deleted: leftoverDeleted,
      },
    });
    if (undone && reverseOf !== null) {
      await recordAudit(trx, ctx, {
        emailId: email.id,
        actionId: reverseOf,
        actor: "system",
        event: auditEvents.actionUndone,
        data: { reverse_action_id: action.id },
      });
    }
    return true;
  });
  // `lost`: the IMAP change stays. The next claimer locates the mail in the target.
  if (!done) return { kind: "lost" };
  log.debug(`action ${action.id}: applied move`);
  return { kind: "applied" };
}

const NEEDS_NOTHING = { provider: false, sender: false, facts: false, sortFolders: false } as const;
const NEEDS_IMAP = { provider: true, sender: false, facts: false, sortFolders: false } as const;

// One handler per action type. A new type fails typecheck here and completeness.test.ts until it has one.
export const APPLY_HANDLERS: Readonly<Record<ActionType, ApplyHandler>> = {
  move: { needs: { ...NEEDS_IMAP, sortFolders: true }, run: applyMove },
  mark_read: { needs: NEEDS_IMAP, run: applyFlag },
  flag: { needs: NEEDS_IMAP, run: applyFlag },
  save_summary: { needs: NEEDS_NOTHING, run: applySummary },
  // A reverse `create_draft` row deletes the draft (the send of the draft ended).
  create_draft: {
    needs: { ...NEEDS_IMAP, facts: true },
    run: (deps, ctx, action, provider) =>
      action.reverses_action_id === null
        ? applyDraft(deps, ctx, action, provider)
        : removeDraft(deps, ctx, action, provider),
  },
  send: { needs: { ...NEEDS_IMAP, sender: true, facts: true }, run: applySend },
};

// Applies one claimed action and writes the result, the mail location and the audit row in one transaction.
// The job handles `auth_error` (mailbox status) and the release of the rest of the batch.
export async function applyAction(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  provider: MailProvider | null
): Promise<ApplyOutcome> {
  const handler = APPLY_HANDLERS[action.type];
  if (!needsImap(handler)) return handler.run(deps, ctx, action);
  if (provider === null) {
    log.error(`action ${action.id}: no provider for ${action.type}`);
    const now = deps.now();
    await releaseAction(deps.db, ctx, action.id, action.locked_at, {
      toStatus: action.status,
      nextAttemptAt: new Date(now.getTime() + RETRY_WAIT_MS),
      countAttempt: false,
      now,
    });
    return { kind: "retry", soft: true };
  }
  return handler.run(deps, ctx, action, provider);
}
