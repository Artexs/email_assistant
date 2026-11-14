import {
  categoryTag,
  pickAnswer,
  pickedText,
  rightAnswer,
  cleanSubject,
  encodeCallback,
  isAnsweredCallback,
  isFeedbackCallback,
  labelCategories,
  parseCallback,
  textsFor,
  type Category,
  type CoreTexts,
  type OutMessage,
} from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { getLabelTarget, recordFeedback, undoWithFeedback } from "../triage";

import { handleAnsweredTap } from "./answered-taps";
import { handleApprovalCallback, type CallbackDeps } from "./approval-taps";
import type { CallbackResult, LinkedChat } from "./port";
import { feedbackTap, reviewPickerMessage } from "./review-taps";

export type { CallbackDeps } from "./approval-taps";

export function pickerMessage(
  emailId: string,
  subject: string | null,
  current: Category,
  texts: CoreTexts
): OutMessage {
  const pick = (category: (typeof labelCategories)[number]) => ({
    text: categoryTag(category, texts),
    data: encodeCallback({ kind: "pick", category, emailId }),
  });
  return {
    text: texts.bot.taps.picker.title(cleanSubject(subject, texts), categoryTag(current, texts)),
    buttons: [
      [pick("urgent"), pick("needs_reply")],
      [pick("info"), pick("notification")],
      [pick("spam"), { text: texts.bot.taps.picker.cancelButton, data: encodeCallback({ kind: "cancel", emailId }) }],
    ],
  };
}

// The tenant comes from the link. An unknown mail id and a mail of another organization give the same answer.
export async function handleCallback(deps: CallbackDeps, link: LinkedChat, data: string): Promise<CallbackResult> {
  const callback = parseCallback(data);
  const texts = textsFor(link.locale);
  const taps = texts.bot.taps;
  if (callback === null) return { answer: taps.invalid };
  const ctx = { orgId: link.orgId, userId: link.userId };
  if (isAnsweredCallback(callback))
    return handleAnsweredTap({ db: deps.db, ctx, link, now: deps.now(), texts }, callback);
  if (!isFeedbackCallback(callback)) return handleApprovalCallback(deps, link, ctx, callback, texts);
  const { tap, source } = feedbackTap(callback);
  if (tap.kind === "cancel") return { answer: "", edit: { text: taps.cancelled, buttons: [] } };
  if (tap.kind === "undo") {
    const result = await undoWithFeedback(deps.db, ctx, tap.emailId, {
      now: deps.now(),
      userId: link.userId,
      scope: deps.actionsScope,
    });
    return { answer: result.kind === "not_found" ? taps.notFound : texts.answers.undo[result.kind] };
  }
  const target = await getLabelTarget(deps.db, ctx, tap.emailId);
  if (!target) return { answer: taps.notFound };
  if (tap.kind === "edit") {
    const picker = source === "review" ? reviewPickerMessage : pickerMessage;
    return { answer: "", send: picker(tap.emailId, target.subject, target.category, texts) };
  }
  const saved = await recordFeedback(deps.db, ctx, {
    emailId: tap.emailId,
    trueCategory: tap.category,
    source,
    userId: link.userId,
    skipIfSame: true,
  });
  if (tap.kind === "right") {
    return { answer: rightAnswer(saved.saved, tap.category, texts) };
  }
  return {
    answer: pickAnswer(saved.saved, texts),
    edit: { text: pickedText(tap.category, target.category, saved.saved, texts), buttons: [] },
  };
}
