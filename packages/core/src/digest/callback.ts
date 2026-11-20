import type { RejectReason } from "../metrics/m3";
import type { Category } from "../triage/categories";

export { encodeCallback, parseCallback } from "./callback-kinds";

export const labelCategories = ["urgent", "needs_reply", "info", "notification", "spam"] as const;
export type LabelCategory = (typeof labelCategories)[number];

export function isLabelCategory(category: Category): category is LabelCategory {
  return (labelCategories as readonly string[]).includes(category);
}

// The review page may also confirm or pick `delegation` (code `d`): without it a delegation mail could never leave the review sample.
export const reviewLabelCategories = [...labelCategories, "delegation"] as const;
export type ReviewLabelCategory = (typeof reviewLabelCategories)[number];

export function isReviewLabelCategory(category: Category): category is ReviewLabelCategory {
  return (reviewLabelCategories as readonly string[]).includes(category);
}

export type FeedbackCallback =
  | { kind: "right"; category: LabelCategory; emailId: string }
  | { kind: "edit"; emailId: string }
  | { kind: "undo"; emailId: string }
  | { kind: "pick"; category: LabelCategory; emailId: string }
  | { kind: "cancel"; emailId: string }
  // The buttons of the /review page: they act as right, pick, edit and cancel, but record the source `review`.
  | { kind: "review_right"; category: ReviewLabelCategory; emailId: string }
  | { kind: "review_pick"; category: ReviewLabelCategory; emailId: string }
  | { kind: "review_edit"; emailId: string }
  | { kind: "review_cancel"; emailId: string };

// The Yes and No buttons of the answered check in /review. They name a mail, but they are not feedback taps.
export type AnsweredCallback = { kind: "answered_yes"; emailId: string } | { kind: "answered_no"; emailId: string };

// The taps on the loop lines of the brief: the loop is named by its id. The tenant and the user come from the chat link.
export type LoopCallback =
  | { kind: "loop_follow_up"; loopId: string }
  | { kind: "loop_later"; loopId: string }
  | { kind: "loop_done"; loopId: string }
  | { kind: "loop_drop"; loopId: string }
  | { kind: "loop_reopen"; loopId: string };

// The Delegate button of a mail row and the pick of a delegate in the picker. They name a mail, but they are not feedback taps.
export type DelegateCallback =
  | { kind: "delegate_open"; emailId: string }
  | { kind: "delegate_pick"; emailId: string; delegateId: string };

// The review of reply drafts in Telegram: `reply_review` asks for the next open reply draft after `afterId` (none: the
// first one); `reply_skip` leaves the draft of `sendId` for now and asks for the next one. The buttons of the review card name a
// send: `reply_redraft` asks for a new text (the user writes one line next), `reply_all` and `reply_use_reply_to` change the
// recipients. `reply_draft` is the "Draft reply" button of a mail (an urgent notice or a digest row): it names the mail.
export type ReplyCallback =
  | { kind: "reply_review"; afterId?: string }
  | { kind: "reply_skip"; sendId: string }
  | { kind: "reply_redraft"; sendId: string }
  | { kind: "reply_all"; sendId: string }
  | { kind: "reply_use_reply_to"; sendId: string }
  | { kind: "reply_draft"; emailId: string };

// The nine taps on an approval or a delegation: approve and reject (one action or a set), send again, went out, delegation
// done, the reject reason and "this was a mistake". They name an action, a set or a delegation.
export type ApprovalCallback =
  | { kind: "approve"; actionId: string }
  | { kind: "reject"; actionId: string }
  | { kind: "approve_set"; setId: string }
  | { kind: "reject_set"; setId: string }
  | { kind: "send_again"; actionId: string }
  | { kind: "went_out"; actionId: string }
  | { kind: "delegation_done"; delegationId: string }
  // After a reject: the reason (p = wrong_person, c = wrong_content, n = not_needed). After a send: "this was a mistake".
  | { kind: "reject_reason"; reason: RejectReason; actionId: string }
  | { kind: "mistake"; actionId: string };

export type Callback =
  | FeedbackCallback
  | ReplyCallback
  | AnsweredCallback
  | LoopCallback
  | DelegateCallback
  | ApprovalCallback;

// The wire format and the family of each kind are in `callbackKinds` (callback-kinds.ts).
