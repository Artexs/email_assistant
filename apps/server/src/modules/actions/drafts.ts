import { buildOutgoingMessage, draftPayloadSchema, type OutgoingMessage } from "@ea/core";
import type { Transaction } from "kysely";
import { z } from "zod";

import type { DB, TenantContext } from "../../platform/db";
import { describeError, SoftError } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";
import { locateByActionId, MailAuthError, type MailProvider } from "../mail";

import type { ApplyDeps, ApplyOutcome } from "./apply";
import { HARD_ERROR_TRIES, RETRY_WAIT_MS } from "./constants";
import { closeDraftOfSend, expireSend } from "./expiry";
import {
  finishAction,
  listSendsOfDraft,
  lockSend,
  markApplying,
  markUndone,
  releaseAction,
  type ClaimedAction,
  type SendRow,
} from "./repo";

const log = createLog("actions");

const OPEN_SEND_STATUSES = ["awaiting_approval", "approved", "applying"];

type DraftResult = Record<string, string | number | boolean | null>;

function inTransaction<T>(db: ApplyDeps["db"], run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

// D8: the message of a draft row, from the payload, the original mail and the mailbox. Throws on a payload that does not parse.
export function buildDraftMessage(deps: ApplyDeps, action: ClaimedAction): OutgoingMessage {
  const { email } = action;
  return buildOutgoingMessage({
    draft: draftPayloadSchema.parse(action.payload),
    draftActionId: action.id,
    createdAt: action.created_at,
    mailbox: { address: deps.mailbox.address },
    owner: deps.owner,
    organization: deps.organization,
    original: {
      fromAddress: email.from_address,
      subject: email.subject,
      receivedAt: email.received_at,
      messageId: email.message_id_header,
      inReplyTo: email.in_reply_to,
      references: email.references_header?.split(/\s+/).filter((id) => id !== "") ?? [],
      bodyText: email.body_text,
    },
  });
}

// The draft failed for good: its open sends expire with `draft_missing`, in the same transaction (D12).
// Lock order: the sends first, then the draft row, as `reject` and `expireSend` do. The reverse order deadlocks with them.
async function failDraft(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  reason: "bad_payload" | "hard_error",
  error?: { lastError: string }
): Promise<ApplyOutcome> {
  const now = deps.now();
  const done = await inTransaction(deps.db, async (trx) => {
    const locked: SendRow[] = [];
    for (const { id } of await listSendsOfDraft(trx, ctx, action.id)) {
      const send = await lockSend(trx, ctx, id);
      if (send !== undefined) locked.push(send);
    }
    if (
      !(await finishAction(trx, ctx, action.id, action.locked_at, {
        status: "failed",
        at: now,
        reason,
        ...(error === undefined ? {} : { lastError: error.lastError, countAttempt: true as const }),
      }))
    ) {
      return false;
    }
    await recordAudit(trx, ctx, {
      emailId: action.email_id,
      actionId: action.id,
      actor: "system",
      event: auditEvents.actionFailed,
      reasonCode: reason,
      data: {
        action_type: "create_draft",
        mailbox_id: deps.mailboxId,
        reverse: action.reverses_action_id !== null,
        attempts: action.attempts + (error ? 1 : 0),
      },
      at: now,
    });
    for (const send of locked) {
      if (send.status !== "awaiting_approval") continue;
      await expireSend(trx, ctx, send.id, {
        reason: "draft_missing",
        now,
        actor: "system",
        hooks: deps.hooks,
        uidplus: deps.mailbox.capabilities.uidplus,
      });
    }
    return true;
  });
  if (!done) return { kind: "lost" };
  log.warn(`action ${action.id}: failed ${reason}`);
  return { kind: "failed", reason };
}

// `append`: the server may have stored the message, so the row stays `applying` and the next claim locates first.
// Before the APPEND, a row that started in this call goes back to `ready`.
async function failedWith(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  error: unknown,
  phase: "before_append" | "append"
): Promise<ApplyOutcome> {
  if (error instanceof MailAuthError) return { kind: "auth_error" };
  const now = deps.now();
  const label = describeError(error);
  const soft = error instanceof SoftError;
  if (!soft && action.attempts + 1 >= HARD_ERROR_TRIES) {
    return failDraft(deps, ctx, action, "hard_error", { lastError: label });
  }
  log.warn(`action ${action.id}: ${label}, try ${action.attempts + 1} of ${HARD_ERROR_TRIES}`);
  await releaseAction(deps.db, ctx, action.id, action.locked_at, {
    toStatus: phase === "before_append" && action.status === "ready" ? "ready" : "applying",
    nextAttemptAt: new Date(now.getTime() + RETRY_WAIT_MS),
    countAttempt: !soft,
    now,
    lastError: label,
  });
  return { kind: "retry", soft };
}

// D12. A ready draft ends as exactly one message in the Drafts folder, whatever happened before.
export async function applyDraft(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  provider: MailProvider
): Promise<ApplyOutcome> {
  if (action.status === "ready") {
    const started = await inTransaction(deps.db, async (trx) => {
      if (!(await markApplying(trx, ctx, action.id, action.locked_at))) return false;
      await recordAudit(trx, ctx, {
        emailId: action.email_id,
        actionId: action.id,
        actor: "system",
        event: auditEvents.actionApplying,
        data: { action_type: "create_draft", mailbox_id: deps.mailboxId },
        at: deps.now(),
      });
      return true;
    });
    if (!started) return { kind: "lost" };
  }

  const payload = draftPayloadSchema.safeParse(action.payload);
  if (!payload.success) return failDraft(deps, ctx, action, "bad_payload");
  const kind = payload.data.kind;

  const hint = action.provider_result?.uid;
  let raw: Buffer;
  let folder: string;
  let found: Awaited<ReturnType<typeof locateByActionId>>;
  try {
    raw = await deps.compose(buildDraftMessage(deps, action));
    folder = await deps.folders.resolve("drafts");
    found = await locateByActionId(provider, folder, {
      actionId: action.id,
      hintUid: typeof hint === "number" ? hint : null,
      since: action.created_at,
    });
  } catch (error) {
    return failedWith(deps, ctx, action, error, "before_append");
  }

  let result: DraftResult;
  if (found !== null) {
    result = { uid: found.uid, folder, found: true };
  } else {
    const sends = await listSendsOfDraft(deps.db, ctx, action.id);
    if (!sends.some((send) => OPEN_SEND_STATUSES.includes(send.status))) {
      return closeDraft(deps, ctx, action);
    }
    try {
      const appended = await provider.appendMessage(folder, raw, ["\\Draft"], action.created_at);
      result = { uid: appended.uid, folder, found: false };
    } catch (error) {
      return failedWith(deps, ctx, action, error, "append");
    }
  }

  await deps.beforeCommit?.();
  const now = deps.now();
  const done = await inTransaction(deps.db, async (trx) => {
    if (
      !(await finishAction(trx, ctx, action.id, action.locked_at, {
        status: "applied",
        at: now,
        providerResult: result,
      }))
    ) {
      return false;
    }
    await recordAudit(trx, ctx, {
      emailId: action.email_id,
      actionId: action.id,
      actor: "system",
      event: auditEvents.actionApplied,
      data: { action_type: "create_draft", kind, found: found !== null },
      at: now,
    });
    // A reject or an expiry that came during the APPEND saw an `applying` draft and left the removal to this step.
    const sends = await listSendsOfDraft(trx, ctx, action.id);
    if (!sends.some((send) => OPEN_SEND_STATUSES.includes(send.status))) {
      await closeDraftOfSend(trx, ctx, action.id, {
        reason: sends.some((send) => send.status === "rejected") ? "rejected" : "expired",
        now,
        uidplus: deps.mailbox.capabilities.uidplus,
      });
    }
    return true;
  });
  // `lost`: the message stays. The next claimer's locate finds it.
  if (!done) return { kind: "lost" };
  log.debug(`action ${action.id}: applied create_draft`);
  return { kind: "applied" };
}

// N12: the send of this draft ended before the APPEND. No message is made for a dead send.
async function closeDraft(deps: ApplyDeps, ctx: TenantContext, action: ClaimedAction): Promise<ApplyOutcome> {
  const now = deps.now();
  const done = await inTransaction(deps.db, async (trx) => {
    if (
      !(await finishAction(trx, ctx, action.id, action.locked_at, {
        status: "expired",
        at: now,
        reason: "send_closed",
      }))
    ) {
      return false;
    }
    await recordAudit(trx, ctx, {
      emailId: action.email_id,
      actionId: action.id,
      actor: "system",
      event: auditEvents.actionExpired,
      reasonCode: "send_closed",
      data: { action_type: "create_draft", reason: "send_closed" },
      at: now,
    });
    return true;
  });
  if (!done) return { kind: "lost" };
  log.info(`action ${action.id}: closed create_draft (send_closed)`);
  return { kind: "expired", reason: "send_closed" };
}

// D13: the payload of a reverse row (`closeDraftOfSend` writes it).
const reversePayloadSchema = z.object({
  kind: z.string(),
  folder: z.string().min(1),
  uid: z.number().int().nullable(),
  reason: z.enum(["sent", "rejected", "expired"]),
});

// D13. The reverse row removes the system's draft once and marks the original `undone`. Not found = done.
export async function removeDraft(
  deps: ApplyDeps,
  ctx: TenantContext,
  action: ClaimedAction,
  provider: MailProvider
): Promise<ApplyOutcome> {
  const originalId = action.reverses_action_id;
  const payload = reversePayloadSchema.safeParse(action.payload);
  if (originalId === null || !payload.success) return failDraft(deps, ctx, action, "bad_payload");
  const { folder, uid, reason } = payload.data;

  let found: Awaited<ReturnType<typeof locateByActionId>>;
  try {
    found = await locateByActionId(provider, folder, {
      actionId: originalId,
      hintUid: uid,
      since: action.original_created_at ?? action.created_at,
    });
    if (found !== null) await provider.deleteMessage(folder, found.uid);
  } catch (error) {
    return failedWith(deps, ctx, action, error, "before_append");
  }

  await deps.beforeCommit?.();
  const now = deps.now();
  const done = await inTransaction(deps.db, async (trx) => {
    if (
      !(await finishAction(trx, ctx, action.id, action.locked_at, {
        status: "applied",
        at: now,
        providerResult: { found: found !== null, uid: found?.uid ?? null },
      }))
    ) {
      return false;
    }
    // Lock order: the reverse row, then the original, as the reverse move does. No `emails` row.
    const undone = await markUndone(trx, ctx, originalId, { at: now, reason });
    await recordAudit(trx, ctx, {
      emailId: action.email_id,
      actionId: action.id,
      actor: "system",
      event: auditEvents.actionApplied,
      data: { action_type: "create_draft", reverse: true, found: found !== null },
      at: now,
    });
    if (undone) {
      await recordAudit(trx, ctx, {
        emailId: action.email_id,
        actionId: originalId,
        actor: "system",
        event: auditEvents.actionUndone,
        data: { reverse_action_id: action.id, reason },
        at: now,
      });
    }
    return true;
  });
  // `lost`: the draft is gone. The next claimer's locate finds nothing and still finishes the row.
  if (!done) return { kind: "lost" };
  log.debug(`action ${action.id}: applied create_draft (reverse)`);
  return { kind: "applied" };
}
