import { renderNoticeEdit, type CoreTexts, type OutMessage, type ReplyCallback } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { getSend } from "../actions";
import { getOrganization, isFeatureOn } from "../tenancy";

import type { CallbackDeps } from "./approval-taps";
import { replyConsentOf } from "./consent";
import { panelListUrlOf } from "./notices/approval";
import type { CallbackResult, LinkedChat, TapSource } from "./port";
import { panelBaseOf, queueNextReviewCard } from "./reply-review";
import { findApprovalCardOfTap } from "./repo";

const log = createLog("channels");

// The message of an owner whose Telegram consent does not cover reply data: one fixed line and the panel link. No card, no address, no text.
export async function replyConsentMessage(
  deps: Pick<CallbackDeps, "db" | "webBaseUrl">,
  ctx: TenantContext,
  texts: CoreTexts
): Promise<OutMessage> {
  const lines = [texts.notices.replyDrafts.consent];
  const base = await panelBaseOf(deps.db, ctx, deps.webBaseUrl);
  const url = base === undefined ? undefined : panelListUrlOf(base);
  if (url !== undefined) lines.push(texts.approvals.panelLine(url));
  return { text: lines.join("\n"), buttons: [] };
}

// After a decision on a reply card (Send, Reject) or a Skip: the next open reply as a review card, or "No more replies waiting."
// The consent was checked when the review began; it is checked again here, because the user may have unlinked since.
export async function nextReviewResult(
  deps: CallbackDeps,
  ctx: TenantContext,
  link: LinkedChat,
  afterId: string | undefined,
  texts: CoreTexts,
  now: Date
): Promise<Pick<CallbackResult, "send">> {
  if (!(await replyConsentOf(deps.db, ctx, [link.userId])).has(link.userId)) {
    return { send: await replyConsentMessage(deps, ctx, texts) };
  }
  const next = await queueNextReviewCard(deps, ctx, link, { now, ...(afterId === undefined ? {} : { afterId }) });
  return next.kind === "none" ? { send: { text: texts.approvals.reply.noMore, buttons: [] } } : {};
}

// `reply_review` (the Review button of the notice) and `reply_skip` (the Skip button of a card). Owners only, flag `reply_drafts` on and
// the Telegram consent of the user must cover reply data (D15, D16). The card itself goes out through the outbox (kind `approval`, so the
// F102 card sync finds it), not as the answer of the tap.
export async function handleReplyCallback(
  deps: CallbackDeps,
  link: LinkedChat,
  ctx: TenantContext,
  callback: ReplyCallback,
  texts: CoreTexts,
  source: TapSource = { messageId: undefined }
): Promise<CallbackResult> {
  const taps = texts.bot.taps;
  if (link.role !== "owner") return { answer: taps.ownerOnly };
  const now = deps.now();
  log.info("tap_received", {
    kind: callback.kind,
    user_id: link.userId,
    ...(callback.kind === "reply_skip" ? { action_id: callback.sendId } : {}),
  });
  if (!(await isFeatureOn(deps.db, ctx, "reply_drafts"))) return { answer: taps.featureOff };
  if (!(await replyConsentOf(deps.db, ctx, [link.userId])).has(link.userId)) {
    return { answer: "", send: await replyConsentMessage(deps, ctx, texts) };
  }
  if (callback.kind === "reply_review") {
    return { answer: "", ...(await nextReviewResult(deps, ctx, link, callback.afterId, texts, now)) };
  }
  const send = await getSend(deps.db, ctx, callback.sendId);
  if (send === undefined || send.payload.kind !== "reply") return { answer: taps.notFound };
  // The skipped card loses its buttons and says so. A send that is not open any more has its own closing edit.
  let edit: OutMessage | undefined;
  if (send.status === "awaiting_approval") {
    const card = await findApprovalCardOfTap(deps.db, ctx, link.userId, send.id, source.messageId);
    const organization = await getOrganization(deps.db, ctx);
    if (card?.text && organization !== undefined) {
      edit = renderNoticeEdit(
        { original: card.text, outcome: "skipped", at: now, timeZone: organization.timezone },
        { channel: card.channel, detail: card.detail, locale: card.locale }
      );
    }
  }
  const next = await nextReviewResult(deps, ctx, link, send.id, texts, now);
  return { answer: "", ...(edit === undefined ? { keyboard: [] } : { edit }), ...next };
}

// After Send or Reject on any card: when the send is a reply, the next open reply follows (D15). Another kind of send: nothing.
export async function nextAfterReplyDecision(
  deps: CallbackDeps,
  ctx: TenantContext,
  link: LinkedChat,
  sendId: string,
  texts: CoreTexts,
  now: Date
): Promise<Pick<CallbackResult, "send">> {
  const send = await getSend(deps.db, ctx, sendId);
  if (send === undefined || send.payload.kind !== "reply") return {};
  return nextReviewResult(deps, ctx, link, sendId, texts, now);
}
