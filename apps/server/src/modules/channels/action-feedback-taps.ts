import {
  rejectReasonText,
  type ApprovalEditOutcome,
  type CoreTexts,
  type OutMessage,
  type RejectReason,
} from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../platform/db";
import { markSentMistake, recordRejectReason } from "../actions";
import { isFeatureOn } from "../tenancy";

import type { CallbackResult, LinkedChat } from "./port";

// The edit of the stored card, built by `callbacks.ts` (the stored text plus one status line).
export type CardEdit = (
  dedupKey: string,
  outcome: ApprovalEditOutcome,
  extra?: { reason?: RejectReason }
) => Promise<OutMessage | undefined>;

export interface FeedbackTapInput {
  db: Db | Transaction<DB>;
  ctx: TenantContext;
  link: LinkedChat;
  now: Date;
  texts: CoreTexts;
  notFound: string; // the "not in your account" answer of `APPROVAL_TEXTS`
  edit: CardEdit;
}

// The reason tap after a reject and the mistake tap after a send (plan D21). The caller checked the owner role.
// Both taps check the flag themselves: a button that was sent before the flag went off writes nothing.
export async function handleReasonTap(
  input: FeedbackTapInput,
  tap: { actionId: string; reason: RejectReason }
): Promise<CallbackResult> {
  const { db, ctx, link, now, texts } = input;
  const answers = texts.approvals.feedbackTaps;
  if (!(await isFeatureOn(db, ctx, "mistake_capture"))) return { answer: answers.off };
  const result = await recordRejectReason(db, ctx, {
    actionId: tap.actionId,
    reason: tap.reason,
    userId: link.userId,
    via: "telegram",
    now,
  });
  switch (result.kind) {
    case "saved":
      return {
        answer: answers.noted(rejectReasonText(tap.reason, texts)),
        edit: await input.edit(`approval:${tap.actionId}`, "rejected_reason", { reason: tap.reason }),
      };
    case "not_rejected":
      return { answer: answers.notRejected };
    case "not_found":
      return { answer: input.notFound };
  }
}

export async function handleMistakeTap(input: FeedbackTapInput, tap: { actionId: string }): Promise<CallbackResult> {
  const { db, ctx, link, now, texts } = input;
  const answers = texts.approvals.feedbackTaps;
  if (!(await isFeatureOn(db, ctx, "mistake_capture"))) return { answer: answers.off };
  const result = await markSentMistake(db, ctx, { actionId: tap.actionId, userId: link.userId, via: "telegram", now });
  switch (result.kind) {
    case "saved":
      return {
        answer: answers.markedMistake,
        edit: await input.edit(`send_result:${tap.actionId}`, "marked_mistake"),
      };
    case "already":
      return { answer: answers.alreadyMarked };
    case "too_late":
      return { answer: answers.tooLate };
    case "not_sent":
      return { answer: answers.notSent };
    case "not_found":
      return { answer: input.notFound };
  }
}
