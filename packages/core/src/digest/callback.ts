import { type RejectReason, rejectReasons } from "../metrics/m3";
import type { Category } from "../triage/categories";

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

export type Callback =
  | FeedbackCallback
  | ReplyCallback
  | AnsweredCallback
  | LoopCallback
  | DelegateCallback
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

export function isAnsweredCallback(callback: Callback): callback is AnsweredCallback {
  return callback.kind === "answered_yes" || callback.kind === "answered_no";
}

export function isReplyCallback(callback: Callback): callback is ReplyCallback {
  return (
    callback.kind === "reply_review" ||
    callback.kind === "reply_skip" ||
    callback.kind === "reply_redraft" ||
    callback.kind === "reply_all" ||
    callback.kind === "reply_use_reply_to" ||
    callback.kind === "reply_draft"
  );
}

export function isLoopCallback(callback: Callback): callback is LoopCallback {
  return (
    callback.kind === "loop_follow_up" ||
    callback.kind === "loop_later" ||
    callback.kind === "loop_done" ||
    callback.kind === "loop_drop" ||
    callback.kind === "loop_reopen"
  );
}

export function isDelegateCallback(callback: Callback): callback is DelegateCallback {
  return callback.kind === "delegate_open" || callback.kind === "delegate_pick";
}

export function isFeedbackCallback(callback: Callback): callback is FeedbackCallback {
  return (
    "emailId" in callback &&
    !isAnsweredCallback(callback) &&
    !isDelegateCallback(callback) &&
    !isReplyCallback(callback)
  );
}

export function isReviewCallback(callback: Callback): boolean {
  return (
    callback.kind === "review_right" ||
    callback.kind === "review_pick" ||
    callback.kind === "review_edit" ||
    callback.kind === "review_cancel"
  );
}

const CODES: Record<ReviewLabelCategory, string> = {
  urgent: "u",
  needs_reply: "r",
  info: "i",
  notification: "n",
  spam: "s",
  delegation: "d",
};
const CODE_TO_CATEGORY = Object.fromEntries(
  Object.entries(CODES).map(([category, code]) => [code, category as ReviewLabelCategory])
) as Record<string, ReviewLabelCategory>;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// The digest prefixes (fr, fc) keep the five label codes; the review prefixes (vr, vc) also take `d`.
const WITH_CODE = new RegExp(`^(fr|fc):([urins]):(${UUID})$|^(vr|vc):([urinsd]):(${UUID})$`);
const WITHOUT_CODE = new RegExp(`^(fe|fx|fu|ve|vx):(${UUID})$`);
const APPROVAL = new RegExp(`^(ap|ar|as|rs|ag|gw|dd|mk):(${UUID})$`);
const ANSWERED = new RegExp(`^(ay|an):(${UUID})$`);
const LOOP = new RegExp(`^(lf|ll|lc|lx|lr):(${UUID})$`);
// `rv` (the first open reply draft) or `rv:<send>` (the next one after it); `rk:<send>` (skip this one).
const REPLY_REVIEW = new RegExp(`^rv(?::(${UUID}))?$`);
const REPLY_SKIP = new RegExp(`^rk:(${UUID})$`);
// `rd` (Redraft), `ra` (Reply all), `ru` (Use Reply-To): a send; `dr` (Draft reply): a mail.
const REPLY_CARD = new RegExp(`^(rd|ra|ru|dr):(${UUID})$`);
const DELEGATE_OPEN = new RegExp(`^dg:(${UUID})$`);
// `dp:<mail>:<delegate>`: each UUID as 22 characters of base64url (16 bytes, no padding), so the data is 48 bytes.
const B64_UUID = "[A-Za-z0-9_-]{22}";
const DELEGATE_PICK = new RegExp(`^dp:(${B64_UUID}):(${B64_UUID})$`);
const REASON = new RegExp(`^rw:([pcn]):(${UUID})$`);
const REASON_CODES: Record<RejectReason, string> = { wrong_person: "p", wrong_content: "c", not_needed: "n" };
const CODE_TO_REASON = Object.fromEntries(rejectReasons.map((reason) => [REASON_CODES[reason], reason])) as Record<
  string,
  RejectReason
>;

// A UUID as 22 characters of base64url. The caller checked the UUID form.
function uuidToBase64Url(id: string): string {
  const hex = id.replaceAll("-", "");
  let binary = "";
  for (let i = 0; i < 32; i += 2) binary += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

// The UUID of 22 characters of base64url, or null. A value that is not the one canonical form of its 16 bytes gives null.
function base64UrlToUuid(value: string): string | null {
  if (!new RegExp(`^${B64_UUID}$`).test(value)) return null;
  let binary: string;
  try {
    binary = atob(`${value.replaceAll("-", "+").replaceAll("_", "/")}==`);
  } catch {
    return null;
  }
  if (binary.length !== 16) return null;
  const hex = [...binary].map((char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return uuidToBase64Url(id) === value ? id : null;
}

// Button data is at most 64 bytes (Telegram); the longest value here is `dp:` with 48.
export function encodeCallback(callback: Callback): string {
  switch (callback.kind) {
    case "approve":
      return `ap:${checkedId(callback.actionId)}`;
    case "reject":
      return `ar:${checkedId(callback.actionId)}`;
    case "approve_set":
      return `as:${checkedId(callback.setId)}`;
    case "reject_set":
      return `rs:${checkedId(callback.setId)}`;
    case "send_again":
      return `ag:${checkedId(callback.actionId)}`;
    case "went_out":
      return `gw:${checkedId(callback.actionId)}`;
    case "delegation_done":
      return `dd:${checkedId(callback.delegationId)}`;
    case "reject_reason":
      return `rw:${REASON_CODES[callback.reason]}:${checkedId(callback.actionId)}`;
    case "mistake":
      return `mk:${checkedId(callback.actionId)}`;
    case "answered_yes":
      return `ay:${checkedId(callback.emailId)}`;
    case "answered_no":
      return `an:${checkedId(callback.emailId)}`;
    case "loop_follow_up":
      return `lf:${checkedId(callback.loopId)}`;
    case "loop_later":
      return `ll:${checkedId(callback.loopId)}`;
    case "loop_done":
      return `lc:${checkedId(callback.loopId)}`;
    case "loop_drop":
      return `lx:${checkedId(callback.loopId)}`;
    case "loop_reopen":
      return `lr:${checkedId(callback.loopId)}`;
    case "reply_review":
      return callback.afterId === undefined ? "rv" : `rv:${checkedId(callback.afterId)}`;
    case "reply_skip":
      return `rk:${checkedId(callback.sendId)}`;
    case "reply_redraft":
      return `rd:${checkedId(callback.sendId)}`;
    case "reply_all":
      return `ra:${checkedId(callback.sendId)}`;
    case "reply_use_reply_to":
      return `ru:${checkedId(callback.sendId)}`;
    case "reply_draft":
      return `dr:${checkedId(callback.emailId)}`;
    case "delegate_open":
      return `dg:${checkedId(callback.emailId)}`;
    case "delegate_pick":
      return `dp:${uuidToBase64Url(checkedId(callback.emailId))}:${uuidToBase64Url(checkedId(callback.delegateId))}`;
    default:
      return encodeFeedback(callback);
  }
}

function checkedId(id: string): string {
  if (!new RegExp(`^${UUID}$`).test(id)) throw new Error("bad id");
  return id;
}

function encodeFeedback(callback: FeedbackCallback): string {
  if (!new RegExp(`^${UUID}$`).test(callback.emailId)) throw new Error("bad email id");
  switch (callback.kind) {
    case "right":
      return `fr:${CODES[callback.category]}:${callback.emailId}`;
    case "pick":
      return `fc:${CODES[callback.category]}:${callback.emailId}`;
    case "edit":
      return `fe:${callback.emailId}`;
    case "cancel":
      return `fx:${callback.emailId}`;
    case "undo":
      return `fu:${callback.emailId}`;
    case "review_right":
      return `vr:${CODES[callback.category]}:${callback.emailId}`;
    case "review_pick":
      return `vc:${CODES[callback.category]}:${callback.emailId}`;
    case "review_edit":
      return `ve:${callback.emailId}`;
    case "review_cancel":
      return `vx:${callback.emailId}`;
  }
}

// Old or forged data gives null.
export function parseCallback(data: string): Callback | null {
  const approval = APPROVAL.exec(data);
  if (approval !== null) {
    const id = approval[2] as string;
    switch (approval[1]) {
      case "ap":
        return { kind: "approve", actionId: id };
      case "ar":
        return { kind: "reject", actionId: id };
      case "as":
        return { kind: "approve_set", setId: id };
      case "rs":
        return { kind: "reject_set", setId: id };
      case "ag":
        return { kind: "send_again", actionId: id };
      case "gw":
        return { kind: "went_out", actionId: id };
      case "mk":
        return { kind: "mistake", actionId: id };
      default:
        return { kind: "delegation_done", delegationId: id };
    }
  }
  const answered = ANSWERED.exec(data);
  if (answered !== null) {
    const emailId = answered[2] as string;
    return answered[1] === "ay" ? { kind: "answered_yes", emailId } : { kind: "answered_no", emailId };
  }
  const loop = LOOP.exec(data);
  if (loop !== null) {
    const loopId = loop[2] as string;
    switch (loop[1]) {
      case "lf":
        return { kind: "loop_follow_up", loopId };
      case "ll":
        return { kind: "loop_later", loopId };
      case "lc":
        return { kind: "loop_done", loopId };
      case "lx":
        return { kind: "loop_drop", loopId };
      default:
        return { kind: "loop_reopen", loopId };
    }
  }
  const review = REPLY_REVIEW.exec(data);
  if (review !== null) {
    return review[1] === undefined ? { kind: "reply_review" } : { kind: "reply_review", afterId: review[1] };
  }
  const skip = REPLY_SKIP.exec(data);
  if (skip !== null) return { kind: "reply_skip", sendId: skip[1] as string };
  const card = REPLY_CARD.exec(data);
  if (card !== null) {
    const id = card[2] as string;
    switch (card[1]) {
      case "rd":
        return { kind: "reply_redraft", sendId: id };
      case "ra":
        return { kind: "reply_all", sendId: id };
      case "ru":
        return { kind: "reply_use_reply_to", sendId: id };
      default:
        return { kind: "reply_draft", emailId: id };
    }
  }
  const open = DELEGATE_OPEN.exec(data);
  if (open !== null) return { kind: "delegate_open", emailId: open[1] as string };
  const pick = DELEGATE_PICK.exec(data);
  if (pick !== null) {
    const emailId = base64UrlToUuid(pick[1] as string);
    const delegateId = base64UrlToUuid(pick[2] as string);
    return emailId === null || delegateId === null ? null : { kind: "delegate_pick", emailId, delegateId };
  }
  const reason = REASON.exec(data);
  if (reason !== null) {
    return {
      kind: "reject_reason",
      reason: CODE_TO_REASON[reason[1] as string] as RejectReason,
      actionId: reason[2] as string,
    };
  }
  const withCode = WITH_CODE.exec(data);
  if (withCode !== null) {
    const prefix = (withCode[1] ?? withCode[4]) as string;
    const category = CODE_TO_CATEGORY[(withCode[2] ?? withCode[5]) as string];
    const emailId = (withCode[3] ?? withCode[6]) as string;
    if (category === undefined) return null;
    switch (prefix) {
      case "fr":
        return { kind: "right", category: category as LabelCategory, emailId };
      case "fc":
        return { kind: "pick", category: category as LabelCategory, emailId };
      case "vr":
        return { kind: "review_right", category, emailId };
      default:
        return { kind: "review_pick", category, emailId };
    }
  }
  const withoutCode = WITHOUT_CODE.exec(data);
  if (withoutCode !== null) {
    const emailId = withoutCode[2] as string;
    switch (withoutCode[1]) {
      case "fe":
        return { kind: "edit", emailId };
      case "fu":
        return { kind: "undo", emailId };
      case "ve":
        return { kind: "review_edit", emailId };
      case "vx":
        return { kind: "review_cancel", emailId };
      default:
        return { kind: "cancel", emailId };
    }
  }
  return null;
}
