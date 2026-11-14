import {
  categoryTag,
  cleanSubject,
  encodeCallback,
  reviewLabelCategories,
  type Category,
  type CoreTexts,
  type FeedbackCallback,
  type FeedbackSource,
  type OutMessage,
  type ReviewLabelCategory,
} from "@ea/core";

// A feedback tap with the review kinds folded into the plain ones (F097 D5): `callbacks.ts` has one branch for each
// action, and `source` tells the digest tap (`telegram`) from the review tap (`review`).
export type FeedbackTap =
  | { kind: "right"; category: ReviewLabelCategory; emailId: string }
  | { kind: "pick"; category: ReviewLabelCategory; emailId: string }
  | { kind: "edit"; emailId: string }
  | { kind: "cancel"; emailId: string }
  | { kind: "undo"; emailId: string };

export function feedbackTap(callback: FeedbackCallback): { tap: FeedbackTap; source: FeedbackSource } {
  switch (callback.kind) {
    case "review_right":
      return { tap: { ...callback, kind: "right" }, source: "review" };
    case "review_pick":
      return { tap: { ...callback, kind: "pick" }, source: "review" };
    case "review_edit":
      return { tap: { ...callback, kind: "edit" }, source: "review" };
    case "review_cancel":
      return { tap: { ...callback, kind: "cancel" }, source: "review" };
    default:
      return { tap: callback, source: "telegram" };
  }
}

// The review picker offers the six review categories (the digest picker keeps its five); its buttons keep the flow `review`.
export function reviewPickerMessage(
  emailId: string,
  subject: string | null,
  current: Category,
  texts: CoreTexts
): OutMessage {
  const pick = (category: ReviewLabelCategory) => ({
    text: categoryTag(category, texts),
    data: encodeCallback({ kind: "review_pick", category, emailId }),
  });
  const [urgent, needsReply, info, notification, spam, delegation] = reviewLabelCategories;
  return {
    text: texts.bot.taps.picker.title(cleanSubject(subject, texts), categoryTag(current, texts)),
    buttons: [
      [pick(urgent), pick(needsReply)],
      [pick(info), pick(notification)],
      [pick(spam), pick(delegation)],
      [{ text: texts.bot.taps.picker.cancelButton, data: encodeCallback({ kind: "review_cancel", emailId }) }],
    ],
  };
}
