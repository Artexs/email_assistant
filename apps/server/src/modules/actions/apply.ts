import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { describeError, HardError, SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";
import {
  INBOX,
  listFolderUids,
  locateKeyOf,
  locateMessage,
  MailAuthError,
  updateEmailLocation,
  type FolderMessageMeta,
  type MailProvider,
} from "../mail";

import { finishAction, markUndone, releaseAction, type ClaimedAction } from "./repo";

const log = createLog("actions");

export const HARD_ERROR_TRIES = 3;
export const RETRY_WAIT_MS = 5 * 60_000;

export type ApplyOutcome =
  | { kind: "applied" }
  | { kind: "failed"; reason: "mail_not_found" | "hard_error" | "no_provider" }
  | { kind: "retry"; soft: boolean }
  | { kind: "auth_error" }
  | { kind: "lost" };

export interface ApplyDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  folderMap: Record<string, string>;
  mailboxId: string;
}

const FLAG_OF_TYPE: Record<string, string> = { flag: "\\Flagged", mark_read: "\\Seen" };

async function inTransaction<T>(db: ApplyDeps["db"], run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
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
    nextAttemptAt: new Date(now.getTime() + RETRY_WAIT_MS),
    countAttempt: true,
    now,
    lastError: label,
  });
  return { kind: "retry", soft: false };
}

async function failNotFound(deps: ApplyDeps, ctx: TenantContext, action: ClaimedAction): Promise<ApplyOutcome> {
  const now = deps.now();
  const done = await inTransaction(deps.db, async (trx) => {
    if (
      !(await finishAction(trx, ctx, action.id, action.locked_at, {
        status: "failed",
        at: now,
        reason: "mail_not_found",
      }))
    ) {
      return false;
    }
    await recordAudit(trx, ctx, {
      emailId: action.email_id,
      actionId: action.id,
      actor: "system",
      event: auditEvents.actionFailed,
      reasonCode: "mail_not_found",
      data: {
        action_type: action.type,
        mailbox_id: deps.mailboxId,
        reverse: action.reverses_action_id !== null,
      },
    });
    return true;
  });
  if (!done) return { kind: "lost" };
  log.warn(`action ${action.id}: failed mail_not_found`);
  return { kind: "failed", reason: "mail_not_found" };
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
    return failNotFound(deps, ctx, action);
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
    if (uid !== email.uid) {
      await updateEmailLocation(trx, ctx, email.id, {
        folder: email.folder,
        uid,
        ...(email.folder === INBOX ? { inboxUid: uid } : {}),
      });
    }
    await recordAudit(trx, ctx, {
      emailId: email.id,
      actionId: action.id,
      actor: "system",
      event: auditEvents.actionApplied,
      data: { action_type: action.type, mailbox_id: deps.mailboxId, reverse: reverseOf !== null },
    });
    if (reverseOf !== null && (await markUndone(trx, ctx, reverseOf, { at: now, reason: "undo" }))) {
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

// Applies one claimed action and writes the result, the mail location and the audit row in one transaction.
// The job handles `auth_error` (mailbox status) and the release of the rest of the batch.
export async function applyAction(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  provider: MailProvider | null
): Promise<ApplyOutcome> {
  if (action.type === "save_summary") {
    return applySummary(deps, ctx, action);
  }
  if (action.type === "move") {
    throw new HardError("move not built");
  }
  if (provider === null) {
    log.error(`action ${action.id}: no provider for ${action.type}`);
    const now = deps.now();
    await releaseAction(deps.db, ctx, action.id, action.locked_at, {
      nextAttemptAt: new Date(now.getTime() + RETRY_WAIT_MS),
      countAttempt: false,
      now,
    });
    return { kind: "retry", soft: true };
  }
  return applyFlag(deps, ctx, action, provider);
}
