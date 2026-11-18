import {
  renderNoticeEdit,
  textsFor,
  type CoreTexts,
  type OutMessage,
  type ReplyCallback,
  type ReplyRecipientMode,
} from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { createLog } from "../../platform/log";
import { getSend, type ApprovalDeps } from "../actions";
import { loopHooks } from "../loops";
import {
  cleanInstruction,
  countRedrafts,
  redraftReply,
  REDRAFT_LIMIT,
  requestReply,
  setReplyRecipients,
  type RedraftReplyResult,
  type RequestReplyResult,
  type SetRecipientsResult,
} from "../replies";
import { getOrganization } from "../tenancy";

import type { CallbackDeps } from "./approval-taps";
import { cardEditHooks } from "./card-edits";
import { replyConsentOf } from "./consent";
import { queue } from "./notices/run";
import type { CallbackResult, LinkedChat, TapSource } from "./port";
import { queueReviewCardOfSend } from "./reply-review";
import { findApprovalCardOfTap, findReplyPrompts, findReplyTargetOfMessage } from "./repo";
import { replyPromptKey } from "./review-keys";

const log = createLog("channels");

type Taps = CoreTexts["bot"]["taps"];
type ChangeCallback = Extract<
  ReplyCallback,
  { kind: "reply_redraft" | "reply_all" | "reply_use_reply_to" | "reply_draft" }
>;

// The question after a Redraft tap: a `reply_prompt` row for this user (the sender sends it with ForceReply). The line that answers it
// is matched by the Telegram message id of this row. A question that no sender took yet is not doubled; a send that was asked about
// before gets a new question (the key counts them).
export async function queueReplyPrompt(
  deps: Pick<CallbackDeps, "db">,
  ctx: TenantContext,
  owner: LinkedChat,
  send: { id: string; email_id: string | null },
  now: Date
): Promise<boolean> {
  if (send.email_id === null) return false;
  const earlier = await findReplyPrompts(deps.db, ctx, owner.userId, send.id);
  if (earlier.some((prompt) => prompt.status === "pending" || prompt.status === "sending")) return false;
  return queue(
    deps.db,
    ctx,
    {
      userId: owner.userId,
      locale: owner.locale,
      kind: "reply_prompt",
      dedupKey: replyPromptKey(send.id, earlier.length + 1),
      emailId: send.email_id,
      view: { emailId: send.email_id },
    },
    now
  );
}

// The answer text for a result that makes no request. Nothing here holds mail text or an address.
function blockedText(taps: Taps, reason: keyof Taps["reply"]["blocked"]): string {
  return taps.reply.blocked[reason];
}

function requestAnswer(taps: Taps, result: RequestReplyResult | RedraftReplyResult): string | undefined {
  switch (result.kind) {
    case "blocked":
      return blockedText(taps, result.reason);
    case "feature_off":
      return taps.featureOff;
    case "forbidden":
      return taps.ownerOnly;
    case "not_found":
      return taps.notFound;
    case "invalid_instruction":
      return taps.reply.instructionLength;
    case "redraft_limit":
      return taps.reply.redraftLimit;
    case "changed":
      return taps.changed;
    case "closed":
      return taps.reply.closed;
    default:
      return undefined;
  }
}

function recipientsAnswer(taps: Taps, result: SetRecipientsResult): string {
  switch (result.kind) {
    case "edited":
      return taps.reply.recipientsDone;
    case "unchanged":
      return taps.reply.recipientsUnchanged;
    case "too_many_recipients":
      return taps.reply.tooManyRecipients;
    case "no_reply_to":
      return taps.reply.noReplyTo;
    case "no_others":
      return taps.reply.noOthers;
    case "bad_recipient":
      return taps.reply.badRecipient;
    case "drafts_off":
      return blockedText(taps, "policy_changed");
    case "changed":
      return taps.changed;
    case "closed":
      return taps.reply.closed;
    case "feature_off":
      return taps.featureOff;
    case "forbidden":
      return taps.ownerOnly;
    case "not_editable":
    case "not_found":
      return taps.notFound;
  }
}

// A tap on a reply that is changed from the chat: Redraft (a question follows), Reply all and Use Reply-To (a new version at once),
// and Draft reply (a request; the card follows). The owner check, the flag and the consent came before (`handleReplyCallback`).
export async function handleReplyChangeTap(
  deps: CallbackDeps,
  link: LinkedChat,
  ctx: TenantContext,
  callback: ChangeCallback,
  texts: CoreTexts,
  source: TapSource
): Promise<CallbackResult> {
  const taps = texts.bot.taps;
  const now = deps.now();
  const actor = { userId: link.userId, via: "telegram" as const };

  if (callback.kind === "reply_draft") {
    const result = await requestReply({ db: deps.db, now: deps.now }, ctx, { ...actor, emailId: callback.emailId });
    if (result.kind === "queued") return { answer: taps.reply.drafting };
    if (result.kind === "open") {
      // A draft of this mail exists. One that waits for a tap shows as a card; one that was tapped is on its way.
      if (result.status === "awaiting_approval") {
        await queueReviewCardOfSend(deps, ctx, link, result.sendId, now);
        return { answer: "" };
      }
      return { answer: taps.sending };
    }
    return { answer: requestAnswer(taps, result) ?? taps.notFound };
  }

  const send = await getSend(deps.db, ctx, callback.sendId);
  if (send === undefined || send.payload.kind !== "reply") return { answer: taps.notFound };
  if (send.status === "expired" && send.status_reason === "superseded") return { answer: taps.changed };
  if (send.status !== "awaiting_approval") return { answer: taps.reply.closed };

  if (callback.kind === "reply_redraft") {
    // Past the limit the question would only lead to a refusal.
    if (send.email_id !== null && (await countRedrafts(deps.db, ctx, send.email_id)) >= REDRAFT_LIMIT) {
      return { answer: taps.reply.redraftLimit };
    }
    await queueReplyPrompt(deps, ctx, link, send, now);
    return { answer: taps.reply.redraftAsk };
  }

  const mode: ReplyRecipientMode = callback.kind === "reply_all" ? "all" : "reply_to";
  const approvals: ApprovalDeps = {
    db: deps.db,
    hooks: deps.hooks,
    approvalHooks: cardEditHooks({ sendScope: deps.sendScope }),
    loopHooks: loopHooks(),
    uidplus: deps.uidplus,
  };
  const result = await setReplyRecipients(approvals, ctx, { ...actor, sendId: send.id, mode, now });
  if (result.kind !== "edited") return { answer: recipientsAnswer(taps, result) };
  // The tapped card shows that a new version replaced it (the hook leaves the tapper's own card to this answer); the new version
  // comes as a card of its own.
  let edit: OutMessage | undefined;
  const card = await findApprovalCardOfTap(deps.db, ctx, link.userId, send.id, source.messageId);
  const organization = await getOrganization(deps.db, ctx);
  if (card?.text && organization !== undefined) {
    edit = renderNoticeEdit(
      { original: card.text, outcome: "changed", at: now, timeZone: organization.timezone },
      { channel: card.channel, detail: card.detail, locale: card.locale }
    );
  }
  await queueReviewCardOfSend(deps, ctx, link, result.sendId, now);
  return { answer: taps.reply.recipientsDone, ...(edit === undefined ? { keyboard: [] } : { edit }) };
}

// A line of text that answers the question after Redraft, or a review card of a reply: one line of instruction for a new version. Any
// other text is not handled here (`undefined`: the bot gives its help answer). The line is data for the model: it never becomes a
// recipient, a folder or a command, and no log line or audit row holds it.
export async function handleReplyText(
  deps: CallbackDeps,
  link: LinkedChat,
  text: string,
  replyToMessageId: number
): Promise<OutMessage | undefined> {
  const ctx = { orgId: link.orgId, userId: link.userId };
  const sendId = await findReplyTargetOfMessage(deps.db, ctx, link, replyToMessageId);
  if (sendId === undefined) return undefined;
  const send = await getSend(deps.db, ctx, sendId);
  if (send === undefined || send.payload.kind !== "reply") return undefined;

  const texts = textsFor(link.locale);
  const taps = texts.bot.taps;
  const say = (line: string): OutMessage => ({ text: line, buttons: [] });
  if (link.role !== "owner") return say(taps.ownerOnly);
  log.info("tap_received", { kind: "reply_text", user_id: link.userId, action_id: sendId });
  if (!(await replyConsentOf(deps.db, ctx, [link.userId])).has(link.userId)) {
    return say(texts.notices.replyDrafts.consent);
  }
  const instruction = cleanInstruction(text);
  if (instruction === null) return say(taps.reply.instructionLength);
  const result = await redraftReply({ db: deps.db, now: deps.now }, ctx, {
    userId: link.userId,
    via: "telegram",
    sendId,
    instruction,
  });
  if (result.kind === "queued") return say(taps.reply.redraftQueued);
  return say(requestAnswer(taps, result) ?? taps.notFound);
}
