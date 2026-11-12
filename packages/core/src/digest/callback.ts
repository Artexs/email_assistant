import type { Category } from "../triage/categories";

export const labelCategories = ["urgent", "needs_reply", "info", "notification", "spam"] as const;
export type LabelCategory = (typeof labelCategories)[number];

export function isLabelCategory(category: Category): category is LabelCategory {
  return (labelCategories as readonly string[]).includes(category);
}

export type FeedbackCallback =
  | { kind: "right"; category: LabelCategory; emailId: string }
  | { kind: "edit"; emailId: string }
  | { kind: "undo"; emailId: string }
  | { kind: "pick"; category: LabelCategory; emailId: string }
  | { kind: "cancel"; emailId: string };

export type Callback =
  | FeedbackCallback
  | { kind: "approve"; actionId: string }
  | { kind: "reject"; actionId: string }
  | { kind: "approve_set"; setId: string }
  | { kind: "reject_set"; setId: string }
  | { kind: "send_again"; actionId: string }
  | { kind: "went_out"; actionId: string }
  | { kind: "delegation_done"; delegationId: string };

export function isFeedbackCallback(callback: Callback): callback is FeedbackCallback {
  return "emailId" in callback;
}

const CODES: Record<LabelCategory, string> = {
  urgent: "u",
  needs_reply: "r",
  info: "i",
  notification: "n",
  spam: "s",
};
const CODE_TO_CATEGORY = Object.fromEntries(
  Object.entries(CODES).map(([category, code]) => [code, category as LabelCategory])
) as Record<string, LabelCategory>;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const WITH_CODE = new RegExp(`^(fr|fc):([urins]):(${UUID})$`);
const WITHOUT_CODE = new RegExp(`^(fe|fx|fu):(${UUID})$`);
const APPROVAL = new RegExp(`^(ap|ar|as|rs|ag|gw|dd):(${UUID})$`);

// Button data is at most 64 bytes (Telegram); the longest value here is 41.
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
      default:
        return { kind: "delegation_done", delegationId: id };
    }
  }
  const withCode = WITH_CODE.exec(data);
  if (withCode !== null) {
    const category = CODE_TO_CATEGORY[withCode[2] as string];
    const emailId = withCode[3] as string;
    if (category === undefined) return null;
    return withCode[1] === "fr" ? { kind: "right", category, emailId } : { kind: "pick", category, emailId };
  }
  const withoutCode = WITHOUT_CODE.exec(data);
  if (withoutCode !== null) {
    const emailId = withoutCode[2] as string;
    if (withoutCode[1] === "fe") return { kind: "edit", emailId };
    return withoutCode[1] === "fu" ? { kind: "undo", emailId } : { kind: "cancel", emailId };
  }
  return null;
}
