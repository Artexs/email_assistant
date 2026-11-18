import type { Transaction } from "kysely";

import type { Db, DB, TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";
import { listMailboxTargets } from "../mail";

import { inTransaction } from "./apply-shared";
import { APPROVAL_TTL_MS, STALE_AFTER_MS, UNNOTIFIED_TTL_MS } from "./constants";
import { noDelegationHooks, type DelegationHooks } from "./hooks";
import {
  expireReadyDraft,
  insertReverse,
  listExpiredApprovals,
  listOpenReminderSends,
  lockAnySend,
  lockDraft,
  setExpired,
  type AnySendRow,
} from "./repo";

const log = createLog("actions");

export type SendCloseReason =
  | "timeout"
  | "draft_missing"
  | "not_notified"
  | "not_seen"
  | "held_timeout"
  | "policy_changed"
  | "delegation_closed"
  // The loop of a follow-up closed (a reply, Done, Drop, the switch off): the follow-up must not go out.
  | "loop_closed";

// An `approved` send closes only for these reasons; a tap was given, so a plain timeout of the request does not apply.
const CLOSES_APPROVED: readonly SendCloseReason[] = ["held_timeout", "delegation_closed", "loop_closed"];

// What `closeLockedSend` found. `busy`: a run holds the row (`applying`, or `approved` with a fresh lock that the caller does not
// own). `not_open`: the send is past the states that can close (`state` names it). `lost`: the guarded write changed no row.
export type CloseLockedResult =
  | { kind: "closed"; send: AnySendRow }
  | { kind: "busy" }
  | { kind: "not_open"; state: string }
  | { kind: "not_found" }
  | { kind: "lost" };

// The cascade of one close, for every reason: the send `expired` with the reason, the audit row, the draft, the delegation. The
// caller holds the transaction. `approvedCloses`: an `approved` send may close for this reason. `claimed`: the caller owns the lock
// of an `approved` row (the committer), so a fresh lock does not stop the close; an `applying` row never closes.
// `resultNotifiedAt`: set when no result notice is due.
export async function closeLockedSend(
  trx: Transaction<DB>,
  ctx: TenantContext,
  sendId: string,
  opts: {
    reason: string;
    now: Date;
    actor: string;
    hooks: DelegationHooks;
    // Read after the state checks, once the mailbox of the send is known.
    uidplus(mailboxId: string): Promise<boolean>;
    approvedCloses: boolean;
    claimed: boolean;
    resultNotifiedAt?: Date;
  }
): Promise<CloseLockedResult> {
  const send = await lockAnySend(trx, ctx, sendId);
  if (send === undefined) return { kind: "not_found" };
  const staleBefore = new Date(opts.now.getTime() - STALE_AFTER_MS);
  if (send.status === "approved") {
    if (!opts.approvedCloses) return { kind: "not_open", state: send.status };
    // A fresh lock that the caller does not own: `setExpired` finds no row below and the answer is `busy`.
  } else if (send.status === "applying") {
    return { kind: "busy" };
  } else if (send.status !== "awaiting_approval") {
    return { kind: "not_open", state: send.status };
  }
  const changed = await setExpired(trx, ctx, sendId, {
    reason: opts.reason,
    at: opts.now,
    from: send.status as "awaiting_approval" | "approved",
    staleBefore,
    ignoreLock: opts.claimed,
    ...(opts.resultNotifiedAt === undefined ? {} : { resultNotifiedAt: opts.resultNotifiedAt }),
  });
  if (!changed) return { kind: "lost" };
  await recordAudit(trx, ctx, {
    emailId: send.email_id,
    actionId: sendId,
    actor: opts.actor,
    event: auditEvents.actionExpired,
    reasonCode: opts.reason,
    data: { action_type: "send", reason: opts.reason, ...(send.loop_id === null ? {} : { loop_id: send.loop_id }) },
    at: opts.now,
  });
  if (send.depends_on_action_id !== null) {
    await closeDraftOfSend(trx, ctx, send.depends_on_action_id, {
      reason: "expired",
      now: opts.now,
      uidplus: await opts.uidplus(send.mailbox_id),
    });
  }
  const delegationId = send.payload.delegation_id;
  if (typeof delegationId === "string" && !("reminder" in send.payload) && opts.reason !== "delegation_closed") {
    await opts.hooks.onCancelled(trx, ctx, {
      delegationId,
      reason: opts.reason === "draft_missing" || opts.reason === "draft_changed" ? opts.reason : "expired",
      at: opts.now,
    });
  }
  return { kind: "closed", send };
}

// The cascade for one send. The caller holds the transaction.
// false = the row was not in a closable state (a tap, a send or another close won).
// A send in flight (`applying`, or `approved` with a fresh lock) finishes. `result_notified_at` stays null.
export async function expireSend(
  trx: Transaction<DB>,
  ctx: TenantContext,
  sendId: string,
  opts: { reason: SendCloseReason; now: Date; actor: string; hooks: DelegationHooks; uidplus: boolean }
): Promise<boolean> {
  const result = await closeLockedSend(trx, ctx, sendId, {
    reason: opts.reason,
    now: opts.now,
    actor: opts.actor,
    hooks: opts.hooks,
    uidplus: () => Promise.resolve(opts.uidplus),
    approvedCloses: CLOSES_APPROVED.includes(opts.reason),
    claimed: false,
  });
  return result.kind === "closed";
}

// The draft of a dead send never lands and never stays behind when the server has UIDPLUS.
// `ready` → expired; `applied` + UIDPLUS → a reverse row; the rest is left to its own step or stays.
export async function closeDraftOfSend(
  trx: Transaction<DB>,
  ctx: TenantContext,
  draftId: string,
  opts: { reason: "sent" | "rejected" | "expired"; now: Date; uidplus: boolean }
): Promise<"reverse" | "expired" | "none"> {
  const draft = await lockDraft(trx, ctx, draftId);
  if (draft === undefined) return "none";
  if (draft.status === "ready") {
    if (!(await expireReadyDraft(trx, ctx, draftId, opts.now))) return "none";
    await recordAudit(trx, ctx, {
      emailId: draft.email_id,
      actionId: draftId,
      actor: "system",
      event: auditEvents.actionExpired,
      reasonCode: "send_closed",
      data: { action_type: "create_draft", reason: opts.reason },
      at: opts.now,
    });
    return "expired";
  }
  if (draft.status === "applied" && opts.uidplus) {
    const kind = draft.payload.kind;
    const folder = draft.provider_result?.folder;
    const uid = draft.provider_result?.uid;
    if (typeof kind !== "string" || typeof folder !== "string") {
      log.warn("draft_reverse_missing", { action_id: draftId });
      return "none";
    }
    await insertReverse(trx, ctx, {
      id: draftId,
      emailId: draft.email_id,
      loopId: draft.loop_id,
      type: "create_draft",
      payload: { kind, folder, uid: typeof uid === "number" ? uid : null, reason: opts.reason },
    });
    return "reverse";
  }
  return "none";
}

// A delegation that is answered, done or cancelled sends no more reminders. Every open reminder send closes with its draft.
// The caller holds the delegation lock (lock order: the delegation, then its sends). An `applying` reminder finishes. `sendIds` are the sends that this call
// closed (a caller that edits their cards queues the edits itself; this function calls no approval hook).
export async function expireReminderActions(
  trx: Transaction<DB>,
  ctx: TenantContext,
  delegationId: string,
  opts: { now: Date; uidplus: boolean; actor: string }
): Promise<{ sends: number; sendIds: string[] }> {
  const ids = await listOpenReminderSends(trx, ctx, delegationId);
  const sendIds: string[] = [];
  let sends = 0;
  for (const id of ids) {
    const closed = await expireSend(trx, ctx, id, {
      reason: "delegation_closed",
      now: opts.now,
      actor: opts.actor,
      hooks: noDelegationHooks,
      uidplus: opts.uidplus,
    });
    if (closed) {
      sends += 1;
      sendIds.push(id);
    }
  }
  return { sends, sendIds };
}

export { APPROVAL_TTL_MS, UNNOTIFIED_TTL_MS };
export const EXPIRY_BATCH = 200;

export interface ExpiryDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  hooks: DelegationHooks;
  uidplus(ctx: TenantContext, mailboxId: string): Promise<boolean>;
  // Test seam: replaces `listExpiredApprovals`.
  listExpired?: typeof listExpiredApprovals;
}

// Every hour. Time passes for paused mailboxes too, so the job walks them as well.
export function createExpiryJob(deps: ExpiryDeps): { run(): Promise<void> } {
  const list = deps.listExpired ?? listExpiredApprovals;

  async function expireMailbox(ctx: TenantContext, mailboxId: string): Promise<void> {
    const now = deps.now();
    const rows = await list(deps.db, ctx, mailboxId, {
      now,
      limit: EXPIRY_BATCH,
      staleBefore: new Date(now.getTime() - STALE_AFTER_MS),
    });
    if (rows.length === 0) return;
    const uidplus = await deps.uidplus(ctx, mailboxId);
    const counts = { timeout: 0, draft_missing: 0, not_notified: 0, not_seen: 0, held_timeout: 0 };
    for (const row of rows) {
      const closed = await inTransaction(deps.db, (trx) =>
        expireSend(trx, ctx, row.id, { reason: row.reason, now, actor: "system", hooks: deps.hooks, uidplus })
      );
      if (closed) counts[row.reason] += 1;
    }
    const total = counts.timeout + counts.draft_missing + counts.not_notified + counts.not_seen + counts.held_timeout;
    if (total > 0) {
      log.info("expiry_done", {
        org_id: ctx.orgId,
        mailbox_id: mailboxId,
        count: total,
        expired_timeout: counts.timeout,
        expired_draft_missing: counts.draft_missing,
        expired_not_notified: counts.not_notified,
        expired_not_seen: counts.not_seen,
        expired_held_timeout: counts.held_timeout,
      });
    }
  }

  return {
    async run() {
      const targets = await listMailboxTargets(deps.db, {
        statuses: ["active", "paused", "auth_error", "host_blocked"],
        includeSuspended: true,
      });
      for (const { orgId, mailboxId } of targets) {
        try {
          await expireMailbox({ orgId }, mailboxId);
        } catch (error) {
          log.error("expiry_failed", { org_id: orgId, mailbox_id: mailboxId, ...errorFields(error) });
        }
      }
    },
  };
}
