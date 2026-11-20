import {
  formatClock,
  noticeKinds,
  noticePath,
  renderNoticeEdit,
  type ApprovalCallback,
  type ApprovalEditOutcome,
  type CoreTexts,
  type HeldBy,
  type OutMessage,
  type RejectReason,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import {
  approve,
  approveSet,
  markWentOut,
  reject,
  rejectSet,
  sendAgain,
  type ActionsScope,
  type ApprovalDeps,
  type DelegationHooks,
  type SendScope,
} from "../actions";
import { closeDelegation } from "../delegation";
import { loopHooks } from "../loops";
import { getOrganization, isFeatureOn } from "../tenancy";

import { handleMistakeTap, handleReasonTap } from "./action-feedback-taps";
import { editBriefLine, lineEditResult } from "./brief-line-edit";
import { cardEditHooks } from "./card-edits";
import { detailOfUser } from "./detail";
import { heldReason } from "./held-reason";
import type { CallbackResult, LinkedChat, TapSource } from "./port";
import { nextAfterReplyDecision } from "./reply-taps";
import { findApprovalCardOfTap, findOutboxByDedup } from "./repo";
import { sendIdOfCardKey } from "./review-keys";

const log = createLog("channels");

export interface CallbackDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  actionsScope: ActionsScope;
  hooks: DelegationHooks;
  uidplus(ctx: TenantContext, mailboxId: string): Promise<boolean>;
  sendScope: SendScope;
  // The base URL of the panel (`WEB_BASE_URL`): the picker of the Delegate button links to the delegates page.
  webBaseUrl?: string;
}

// The panel path of the card that a tap edits, from its dedup key (`<kind>:<id>`): an approval card links to its send, any other
// card to the page of its kind.
function panelPathOfCard(dedupKey: string, sendId: string | null): string | undefined {
  const [prefix = "", rest = ""] = dedupKey.split(":");
  const kind = noticeKinds.find((candidate) => candidate === prefix);
  if (kind === undefined) return undefined;
  return noticePath(kind, kind === "approval" ? (sendId ?? rest) : null);
}

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
  texts: CoreTexts,
  source: TapSource = { messageId: undefined }
): Promise<CallbackResult> {
  const taps = texts.bot.taps;
  if (callback.kind !== "delegation_done" && link.role !== "owner") return { answer: taps.ownerOnly };
  const now = deps.now();
  const target =
    "actionId" in callback
      ? { action_id: callback.actionId }
      : "setId" in callback
        ? { approval_set_id: callback.setId }
        : { delegation_id: callback.delegationId };
  log.info("tap_received", { kind: callback.kind, user_id: link.userId, ...target });
  const organization = await getOrganization(deps.db, ctx);
  if (organization === undefined) return { answer: taps.notFound };
  const timeZone = organization.timezone;
  // After a decision the hook queues the edits of the other cards of the send (not the tapped one: the answer edits it).
  const approvals: ApprovalDeps = {
    db: deps.db,
    hooks: deps.hooks,
    approvalHooks: cardEditHooks({ sendScope: deps.sendScope }),
    loopHooks: loopHooks(),
    uidplus: deps.uidplus,
  };
  const input = { userId: link.userId, via: "telegram" as const, now };
  // The card as the user got it (the stored text) plus one status line (docs/architecture.md §4.5). A row that was never
  // sent has no text: no edit, only the answer.
  const edit = async (
    dedupKey: string,
    outcome: ApprovalEditOutcome,
    extra: {
      heldBy?: HeldBy;
      actionId?: string;
      counts?: { done: number; skipped: number };
      reason?: RejectReason;
      reasonButtons?: boolean;
    } = {}
  ): Promise<OutMessage | undefined> => {
    // The card of a send is `approval:<send>` or, for a reply in the review, `approval:<send>:r<n>`: the tap names its message.
    const cardOf = sendIdOfCardKey(dedupKey);
    const row =
      cardOf === null
        ? await findOutboxByDedup(deps.db, ctx, link.userId, dedupKey)
        : await findApprovalCardOfTap(deps.db, ctx, link.userId, cardOf, source.messageId);
    if (row === undefined || row.text === null || row.text === "") return undefined;
    // The level of the member now: at `minimal` the edit has no button, also on a card that went out at `full`.
    // At `minimal` a card without a panel link gets the link line, so the member can still decide in the panel.
    return renderNoticeEdit(
      { original: row.text, outcome, at: now, timeZone, panelPath: panelPathOfCard(dedupKey, cardOf), ...extra },
      {
        channel: row.channel,
        detail: await detailOfUser(deps.db, ctx, link.userId),
        locale: row.locale,
        ...(deps.webBaseUrl === undefined ? {} : { webBaseUrl: deps.webBaseUrl }),
      }
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
            // A reply in the review: the next one follows the decision
            ...(await nextAfterReplyDecision(deps, ctx, link, callback.actionId, texts, now)),
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
        case "superseded":
          return { answer: taps.changed };
        case "draft_not_ready":
          return { answer: taps.draftNotReady };
        case "has_gaps":
          return { answer: taps.hasGaps };
        case "feature_off":
          return { answer: taps.featureOff };
        case "not_found":
          return { answer: taps.notFound };
      }
      break;
    }
    case "reject": {
      const result = await reject(approvals, ctx, callback.actionId, input);
      if (result.kind === "rejected") {
        // The reason buttons only while the flag is on.
        const reasonButtons = await isFeatureOn(deps.db, ctx, "mistake_capture");
        return {
          answer: taps.rejectedNow,
          edit: await edit(
            `approval:${callback.actionId}`,
            "rejected",
            reasonButtons ? { actionId: callback.actionId, reasonButtons } : {}
          ),
          ...(await nextAfterReplyDecision(deps, ctx, link, callback.actionId, texts, now)),
        };
      }
      if (result.kind === "already") return { answer: statusText(taps, result.status) ?? taps.notFound };
      if (result.kind === "superseded") return { answer: taps.changed };
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
      // The button also sits on a ⏳ line of the digest: the tapped message is then the digest, and its edit is that line.
      // The edit of the "delegation answered" notice must never go to a digest message: its text would replace the digest.
      const digest =
        source.messageId === undefined || (result.kind !== "done" && result.kind !== "already")
          ? ({ digest: false } as const)
          : await editBriefLine(deps.db, ctx, link, {
              messageId: source.messageId,
              id: callback.delegationId,
              mark: result.kind === "done" ? texts.loopTaps.marks.done : null,
              drop: "all",
            });
      switch (result.kind) {
        case "done":
          return digest.digest
            ? { answer: taps.done, ...lineEditResult(digest) }
            : { answer: taps.done, edit: await edit(`delegation_answered:${callback.delegationId}`, "done") };
        case "already":
          return { answer: taps.doneAlready, ...lineEditResult(digest) };
        case "not_closable":
          return { answer: taps.doneNotClosable };
        case "not_found":
          return { answer: taps.notFound };
      }
    }
  }
  return { answer: taps.notFound };
}
function heldAnswers(taps: CoreTexts["bot"]["taps"]): Record<HeldBy, string> {
  return {
    scope: taps.approvedHeld,
    paused: taps.approvedPaused,
    auth_error: taps.approvedAuthError,
    host_blocked: taps.approvedHostBlocked,
  };
}

// A set holds the first cause found among its approved sends: the mailbox is the same, the recipients can differ.
async function heldReasonOfAny(
  deps: CallbackDeps,
  ctx: TenantContext,
  actionIds: string[]
): Promise<HeldBy | undefined> {
  for (const actionId of actionIds) {
    const reason = await heldReason(deps, ctx, actionId);
    if (reason !== undefined) return reason;
  }
  return undefined;
}
