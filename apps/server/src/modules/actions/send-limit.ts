import { checkSendLimits, SEND_LIMIT_WINDOW_MS, sendLimitError, type SendLimitKind, type SendLimits } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, TenantContext } from "../../platform/db";
import { auditEvents, recordAudit } from "../audit";

import { listRecentSends, lockMailboxSends, markApplying, releaseAction, type ClaimedAction } from "./repo";

// What the committer tells the callback: a send did not start because of a limit.
export interface SendLimitHit {
  mailboxId: string;
  limit: SendLimitKind;
  until: Date;
  // The committer's `now`.
  at: Date;
}

export type SendStart = { kind: "started" } | { kind: "held"; hit: SendLimitHit } | { kind: "lost" };

// PD-044 (D6). Runs in the caller's transaction, under the mailbox's send lock: the check and `markApplying`
// are one unit, so two committers never pass a limit together. A held send goes back to `approved` with no attempt counted.
export async function startSendWithinLimits(
  trx: Transaction<DB>,
  ctx: TenantContext,
  input: {
    action: ClaimedAction;
    mailboxId: string;
    // `payload.to` of the parsed send payload.
    to: readonly string[];
    // `payload.kind`, for the applying audit row.
    kind: string;
    outgoingMessageId: string;
    limits: SendLimits;
    now: Date;
  }
): Promise<SendStart> {
  const { action, mailboxId, now } = input;
  await lockMailboxSends(trx, ctx, mailboxId);
  const recent = await listRecentSends(trx, ctx, mailboxId, new Date(now.getTime() - SEND_LIMIT_WINDOW_MS.mailbox_day));
  const result = checkSendLimits({ now, recent, to: input.to, limits: input.limits });

  if (result.kind === "ok") {
    if (
      !(await markApplying(trx, ctx, action.id, action.locked_at, {
        outgoingMessageId: input.outgoingMessageId,
        sendStartedAt: now,
      }))
    ) {
      return { kind: "lost" };
    }
    await recordAudit(trx, ctx, {
      emailId: action.email_id,
      actionId: action.id,
      actor: "system",
      event: auditEvents.actionApplying,
      data: { action_type: "send", kind: input.kind },
      at: now,
    });
    return { kind: "started" };
  }

  const { limit, until } = result;
  if (
    !(await releaseAction(trx, ctx, action.id, action.locked_at, {
      toStatus: "approved",
      nextAttemptAt: until,
      countAttempt: false,
      now,
      lastError: sendLimitError(limit),
    }))
  ) {
    return { kind: "lost" };
  }
  await recordAudit(trx, ctx, {
    emailId: action.email_id,
    actionId: action.id,
    actor: "system",
    event: auditEvents.actionSendLimited,
    reasonCode: "send_limit",
    data: { limit, until: until.toISOString(), mailbox_id: mailboxId },
    at: now,
  });
  return { kind: "held", hit: { mailboxId, limit, until, at: now } };
}
