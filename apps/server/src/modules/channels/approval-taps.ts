import {
  formatClock,
  renderNoticeEdit,
  type ApprovalEditOutcome,
  type Callback,
  type CoreTexts,
  type FeedbackCallback,
  type OutMessage,
  type RejectReason,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import {
  approve,
  approveSet,
  getSend,
  markWentOut,
  reject,
  rejectSet,
  sendAgain,
  sendFilterFor,
  sendScopeAdmits,
  type ActionsScope,
  type ApprovalDeps,
  type DelegationHooks,
  type SendScope,
} from "../actions";
import { closeDelegation } from "../delegation";
import { getMailbox } from "../mail";
import { getOrganization, isFeatureOn } from "../tenancy";

import { handleMistakeTap, handleReasonTap } from "./action-feedback-taps";
import type { CallbackResult, LinkedChat } from "./port";
import { findOutboxByDedup } from "./repo";

const log = createLog("channels");

export interface CallbackDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  actionsScope: ActionsScope;
  hooks: DelegationHooks;
  uidplus(ctx: TenantContext, mailboxId: string): Promise<boolean>;
  sendScope: SendScope;
}

type ApprovalCallback = Exclude<Callback, FeedbackCallback>;

function statusText(taps: CoreTexts["bot"]["taps"], status: string): string | undefined {
  const texts: Record<string, string> = {
    applied: taps.sent,
    applying: taps.sending,
    approved: taps.sending,
    rejected: taps.rejected,
    expired: taps.expired,
    failed: taps.failed,
  };
  return texts[status];
}

function inTransaction<T>(db: Db | Transaction<DB>, run: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
}

// The role check comes before any query; the tenant comes from the link. An unknown id and another
// organization's id give the same answer. The log line holds the kind and the id only.
export async function handleApprovalCallback(
  deps: CallbackDeps,
  link: LinkedChat,
  ctx: TenantContext,
  callback: ApprovalCallback,
  texts: CoreTexts
): Promise<CallbackResult> {
  const taps = texts.bot.taps;
  if (callback.kind !== "delegation_done" && link.role !== "owner") return { answer: taps.ownerOnly };
  const now = deps.now();
  const id = "actionId" in callback ? callback.actionId : "setId" in callback ? callback.setId : callback.delegationId;
  log.info(`tap ${callback.kind} ${id} by user ${link.userId}`);
  const organization = await getOrganization(deps.db, ctx);
  if (organization === undefined) return { answer: taps.notFound };
  const timeZone = organization.timezone;
  const approvals: ApprovalDeps = { db: deps.db, hooks: deps.hooks, uidplus: deps.uidplus };
  const input = { userId: link.userId, via: "telegram" as const, now };
  // The card as the user got it (the stored text) plus one status line (docs/architecture.md §4.5). A row that was never
  // sent has no text: no edit, only the answer.
  const edit = async (
    dedupKey: string,
    outcome: ApprovalEditOutcome,
    extra: {
      heldBy?: "scope" | "paused" | "auth_error";
      actionId?: string;
      counts?: { done: number; skipped: number };
      reason?: RejectReason;
      reasonButtons?: boolean;
    } = {}
  ): Promise<OutMessage | undefined> => {
    const row = await findOutboxByDedup(deps.db, ctx, link.userId, dedupKey);
    if (row === undefined || row.text === null || row.text === "") return undefined;
    return renderNoticeEdit(
      { original: row.text, outcome, at: now, timeZone, ...extra },
      { channel: row.channel, detail: row.detail, locale: row.locale }
    );
  };

  switch (callback.kind) {
    case "approve": {
      const result = await approve(approvals, ctx, callback.actionId, input);
      switch (result.kind) {
        case "approved": {
          const heldBy = await heldReason(deps, ctx, callback.actionId);
          return {
            answer: heldBy === undefined ? taps.approved : heldAnswers(taps)[heldBy],
            edit: await edit(
              `approval:${callback.actionId}`,
              heldBy === undefined ? "approved" : "approved_held",
              heldBy === undefined ? {} : { heldBy, actionId: callback.actionId }
            ),
          };
        }
        case "already_approved":
          return { answer: taps.alreadyApproved(formatClock(result.at, timeZone, now, texts.locale)) };
        case "expired":
          // Only the tap that expired the row edits the message; a later tap on an expired row only answers.
          return {
            answer: taps.expired,
            edit: result.byThisTap ? await edit(`approval:${callback.actionId}`, "expired") : undefined,
          };
        case "sending":
          return { answer: taps.sending };
        case "sent":
          return { answer: taps.sent };
        case "rejected":
          return { answer: taps.rejected };
        case "failed":
          return { answer: taps.failed };
        case "draft_not_ready":
          return { answer: taps.draftNotReady };
        case "not_found":
          return { answer: taps.notFound };
      }
      break;
    }
    case "reject": {
      const result = await reject(approvals, ctx, callback.actionId, input);
      if (result.kind === "rejected") {
        // The reason buttons only while the flag is on (plan D21).
        const reasonButtons = await isFeatureOn(deps.db, ctx, "mistake_capture");
        return {
          answer: taps.rejectedNow,
          edit: await edit(
            `approval:${callback.actionId}`,
            "rejected",
            reasonButtons ? { actionId: callback.actionId, reasonButtons } : {}
          ),
        };
      }
      if (result.kind === "already") return { answer: statusText(taps, result.status) ?? taps.notFound };
      return { answer: taps.notFound };
    }
    case "approve_set": {
      const result = await approveSet(approvals, ctx, callback.setId, input);
      if (result.approved === 0) return { answer: taps.setNothing };
      const heldBy = await heldReasonOfAny(deps, ctx, result.approvedIds);
      return {
        answer:
          heldBy === undefined
            ? taps.setApproved(result.approved, result.skipped)
            : taps.setApprovedHeld(result.approved, result.skipped, taps.heldNotes[heldBy]),
        edit:
          heldBy === undefined
            ? await edit(`approval_set:${callback.setId}`, "approved_set", {
                counts: { done: result.approved, skipped: result.skipped },
              })
            : await edit(`approval_set:${callback.setId}`, "approved_held", { heldBy }),
      };
    }
    case "reject_set": {
      const result = await rejectSet(approvals, ctx, callback.setId, input);
      if (result.rejected === 0) return { answer: taps.setNothing };
      return {
        answer: taps.setRejected(result.rejected),
        edit: await edit(`approval_set:${callback.setId}`, "rejected_set", {
          counts: { done: result.rejected, skipped: result.skipped },
        }),
      };
    }
    case "send_again": {
      const result = await sendAgain(approvals, ctx, callback.actionId, input);
      switch (result.kind) {
        case "created": {
          const heldBy = await heldReason(deps, ctx, result.actionId);
          return {
            answer: heldBy === undefined ? taps.sendAgain : taps.sendAgainHeld[heldBy],
            edit:
              heldBy === undefined
                ? await edit(`send_result:${callback.actionId}`, "approved")
                : await edit(`send_result:${callback.actionId}`, "approved_held", {
                    heldBy,
                    actionId: result.actionId,
                  }),
          };
        }
        case "already":
          return { answer: taps.sendAgainAlready };
        case "not_failed":
          return { answer: taps.sendAgainNotFailed };
        case "draft_gone":
          return { answer: taps.sendAgainDraftGone };
        case "delegation_closed":
          return { answer: taps.sendAgainDelegationClosed };
        case "not_found":
          return { answer: taps.notFound };
      }
      break;
    }
    case "went_out": {
      const result = await markWentOut(approvals, ctx, callback.actionId, input);
      switch (result.kind) {
        case "went_out":
          return {
            answer: taps.wentOut,
            edit: await edit(`send_result:${callback.actionId}`, "went_out"),
          };
        case "already":
          return { answer: taps.wentOutAlready };
        case "sent_again":
          return { answer: taps.wentOutSentAgain };
        case "not_unknown":
          return { answer: taps.wentOutNotUnknown };
        case "delegation_not_open":
          return { answer: taps.wentOutDelegationNotOpen };
        case "not_found":
          return { answer: taps.notFound };
      }
      break;
    }
    case "reject_reason":
      return handleReasonTap(
        { db: deps.db, ctx, link, now, texts, notFound: taps.notFound, edit },
        { actionId: callback.actionId, reason: callback.reason }
      );
    case "mistake":
      return handleMistakeTap(
        { db: deps.db, ctx, link, now, texts, notFound: taps.notFound, edit },
        { actionId: callback.actionId }
      );
    case "delegation_done": {
      const result = await inTransaction(deps.db, (trx) =>
        closeDelegation(trx, ctx, callback.delegationId, { actor: link.userId, at: now })
      );
      switch (result.kind) {
        case "done":
          return {
            answer: taps.done,
            edit: await edit(`delegation_answered:${callback.delegationId}`, "done"),
          };
        case "already":
          return { answer: taps.doneAlready };
        case "not_closable":
          return { answer: taps.doneNotClosable };
        case "not_found":
          return { answer: taps.notFound };
      }
    }
  }
  return { answer: taps.notFound };
}
function heldAnswers(taps: CoreTexts["bot"]["taps"]) {
  return { scope: taps.approvedHeld, paused: taps.approvedPaused, auth_error: taps.approvedAuthError };
}

// Why the committer will not claim the send just approved: the state of the mailbox first, then the scope (as /status).
// A send or mailbox that cannot be read counts as held by the scope: the toast must not promise a send.
async function heldReason(
  deps: CallbackDeps,
  ctx: TenantContext,
  actionId: string
): Promise<"scope" | "paused" | "auth_error" | undefined> {
  const send = await getSend(deps.db, ctx, actionId);
  const mailbox = send === undefined ? undefined : await getMailbox(deps.db, ctx, send.email.mailbox_id);
  if (send === undefined || mailbox === undefined) return "scope";
  const to = Array.isArray(send.payload.to) ? send.payload.to.filter((item) => typeof item === "string") : [];
  if (mailbox.status === "paused") return "paused";
  if (mailbox.status === "auth_error") return "auth_error";
  if (!sendScopeAdmits(sendFilterFor(deps.sendScope), to)) return "scope";
  return undefined;
}

// A set holds the first cause found among its approved sends: the mailbox is the same, the recipients can differ.
async function heldReasonOfAny(
  deps: CallbackDeps,
  ctx: TenantContext,
  actionIds: string[]
): Promise<"scope" | "paused" | "auth_error" | undefined> {
  for (const actionId of actionIds) {
    const reason = await heldReason(deps, ctx, actionId);
    if (reason !== undefined) return reason;
  }
  return undefined;
}
