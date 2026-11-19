import {
  approvalEndReasons,
  bareAddress,
  cleanReplyInstruction,
  MAX_REDRAFTS,
  replyBlockReasons,
  replyConflictSchema,
  replyRecipientsRefusals,
  REPLY_INSTRUCTION_MAX,
  type ApprovalDetail,
  type ApprovalEndReason,
  type ReplyConflict,
} from "@ea/core/web";

import type { TextKey } from "../i18n";
import { ApiError } from "./api";
import { closedTextKey } from "./approvals-view";
import { errorText } from "./errors";

type BlockReason = (typeof replyBlockReasons)[number];
type Refusal = (typeof replyRecipientsRefusals)[number];
type View = NonNullable<ApprovalDetail["view"]>;

export { REPLY_INSTRUCTION_MAX };

// Why a request for a draft was refused (409 `blocked`). A record: a new reason breaks the build until it has a text.
export const BLOCKED_TEXTS: Record<BlockReason, TextKey> = {
  not_checked: "rp_blocked_not_checked",
  category: "rp_blocked_category",
  junk_source: "rp_blocked_junk_source",
  not_a_person: "rp_blocked_not_a_person",
  own_mailbox: "rp_blocked_own_mailbox",
  suspicious: "rp_blocked_suspicious",
  calendar: "rp_blocked_calendar",
  answered: "rp_blocked_answered",
  too_old: "rp_blocked_too_old",
  language: "rp_blocked_language",
  open_newer: "rp_blocked_open_newer",
  oauth_mailbox: "rp_blocked_oauth_mailbox",
  policy_changed: "rp_blocked_policy_changed",
};

// The 400 codes of the recipients route that have a text. `validation` is not here: the page checks the line before it sends.
export const REFUSAL_TEXTS: Record<Refusal, TextKey> = {
  too_many_recipients: "rp_err_too_many_recipients",
  no_reply_to: "rp_err_no_reply_to",
  no_others: "rp_err_no_others",
  bad_recipient: "rp_err_bad_recipient",
  unchanged: "rp_err_unchanged",
  not_editable: "rp_err_not_editable",
};

// How a closed send reads on the page: the reason that the system closed it with.
export const END_REASON_TEXTS: Record<ApprovalEndReason, TextKey> = {
  answered: "rp_end_answered",
  newer_mail: "rp_end_newer_mail",
  original_moved: "rp_end_original_moved",
  policy_changed: "rp_end_policy_changed",
  suspicious: "rp_end_suspicious",
  sent_by_user: "rp_end_sent_by_user",
  draft_changed: "rp_end_draft_changed",
  draft_missing: "rp_end_draft_missing",
};

// The codes of a request that ended with no new version (`reasonCode` of the status route). A reason of the eligibility rule has its own
// text (`BLOCKED_TEXTS`); a code with neither gets the generic line, so a new server code never shows as an empty text.
const RESULT_TEXTS: Record<string, TextKey> = {
  needs_facts: "rp_result_needs_facts",
  not_a_reply: "rp_result_not_a_reply",
  unsafe_request: "rp_result_unsafe_request",
  no_text: "rp_result_no_text",
  timeout: "rp_result_timeout",
  llm_cap: "rp_result_llm_cap",
  llm_error: "rp_result_llm_error",
  checks: "rp_result_checks",
  output: "rp_result_output",
  internal: "rp_result_internal",
  closed: "rp_result_closed",
  changed: "rp_result_changed",
  feature_off: "rp_result_org_off",
  switch_off: "rp_result_off",
  not_assist: "rp_result_off",
  mail_gone: "rp_result_mail_gone",
};

export function resultTextKey(reasonCode: string | null): TextKey {
  if (reasonCode === null) return "rp_result_generic";
  if (Object.hasOwn(RESULT_TEXTS, reasonCode)) return RESULT_TEXTS[reasonCode] ?? "rp_result_generic";
  if (Object.hasOwn(BLOCKED_TEXTS, reasonCode)) return BLOCKED_TEXTS[reasonCode as BlockReason];
  return "rp_result_generic";
}

// The text under a state of a send that the system closed, or null (a timeout and every other state have none).
export function endReasonKey(detail: Pick<ApprovalDetail, "state" | "endReason">): TextKey | null {
  if (detail.state !== "expired" || detail.endReason === undefined) return null;
  return approvalEndReasons.includes(detail.endReason) ? END_REASON_TEXTS[detail.endReason] : null;
}

// A send that the system stops when its copy in Drafts changed (every reply, and any kind while the flag `draft_copy_check` is on): the
// text may say that the owner can edit and send in the mail client. The same rule as the Telegram card line.
export function copyChecked(view: Pick<View, "kind" | "copyCheck">): boolean {
  return view.kind === "reply" || view.copyCheck === true;
}

// What the page does with a failed reply call (a request, a redraft or a recipients change).
export type ReplyFailure =
  | { kind: "changed"; currentId: string | null } // reload the newest version
  | { kind: "closed"; key: TextKey } // the send ended: say it and reload
  | { kind: "message"; key: TextKey } // say it, stay on the item
  | { kind: "gone" } // the send or the mail does not exist (any more)
  | { kind: "error"; key: TextKey };

function conflictFailure(conflict: ReplyConflict): ReplyFailure {
  switch (conflict.error) {
    case "blocked":
      return {
        kind: "message",
        key: conflict.reason === undefined ? "rp_result_generic" : BLOCKED_TEXTS[conflict.reason],
      };
    case "changed":
      return { kind: "changed", currentId: conflict.currentId ?? null };
    case "closed":
      return { kind: "closed", key: closedTextKey(conflict.state) };
    case "redraft_limit":
      return { kind: "message", key: "rp_err_redraft_limit" };
    case "drafts_off":
      return { kind: "message", key: "rp_err_drafts_off" };
  }
}

export function replyFailure(error: unknown): ReplyFailure {
  if (!(error instanceof ApiError)) return { kind: "error", key: errorText(error) };
  if (error.status === 404) return { kind: "gone" };
  if (error.status === 409) {
    const conflict = replyConflictSchema.safeParse(error.raw);
    return conflict.success ? conflictFailure(conflict.data) : { kind: "error", key: errorText(error) };
  }
  if (error.status === 400) {
    const refusal = replyRecipientsRefusals.find((code) => code === error.code);
    if (refusal !== undefined) return { kind: "message", key: REFUSAL_TEXTS[refusal] };
    if (error.code === "validation") return { kind: "message", key: "rp_err_instruction" };
  }
  return { kind: "error", key: errorText(error) };
}

export interface InstructionState {
  // The characters of the cleaned line, as the service counts them.
  length: number;
  max: number;
  // The line is accepted by the service: 1 to 300 characters after cleaning.
  ok: boolean;
  // The line that goes in the body (cleaned), or null while it is not accepted.
  line: string | null;
}

export function instructionState(text: string): InstructionState {
  const line = cleanReplyInstruction(text);
  // Over the limit `line` is null; the count still shows how far over the text is.
  const clean = text.replace(/\s+/g, " ").trim();
  return {
    length: line === null ? Array.from(clean).length : Array.from(line).length,
    max: REPLY_INSTRUCTION_MAX,
    ok: line !== null,
    line,
  };
}

// The redrafts left for a mail. An item without the number (an old answer) counts as all five: the page and the button read one rule.
export function redraftsLeftOf(value: number | undefined): number {
  return value ?? MAX_REDRAFTS;
}

export interface RedraftState {
  // The button is on: the line is accepted, redrafts are left, and no request waits.
  enabled: boolean;
  // The text that tells why the button is off for a reason other than the line (no redrafts left), or null.
  reason: TextKey | null;
}

// `waiting`: a request of this page has no answer yet. Several lines sent at once would all get the same request id and only the first would be
// stored, so the button stays off until the request ends.
export function redraftState(input: {
  redraftsLeft: number | undefined;
  line: string | null;
  waiting: boolean;
}): RedraftState {
  const left = redraftsLeftOf(input.redraftsLeft);
  if (left <= 0) return { enabled: false, reason: "rp_redraft_none" };
  return { enabled: input.line !== null && !input.waiting, reason: null };
}

export interface AddressText {
  // The address as the page shows it. An address with characters outside ASCII shows its domain in punycode.
  text: string;
  // The address holds characters that can look like other letters: the page shows a mark next to it.
  unusual: boolean;
}

const ASCII = /^[ -~]*$/;

// One stored address entry (`a@b` or `Name <a@b>`) as the page shows it before a send. A letter from another script can look like a
// Latin one (`а` is Cyrillic), so an address outside ASCII is marked and its domain shows as punycode (`xn--…`), which is plain ASCII.
// The local part cannot be written in punycode: it stays, and the mark is the warning.
export function addressText(entry: string): AddressText {
  if (ASCII.test(entry)) return { text: entry, unusual: false };
  const bare = bareAddress(entry);
  const address = bare ?? entry;
  const at = address.lastIndexOf("@");
  let shown = address;
  if (at > 0) {
    try {
      const host = new URL(`http://${address.slice(at + 1)}`).hostname;
      if (host !== "") shown = `${address.slice(0, at)}@${host}`;
    } catch {
      // A domain that no URL accepts is shown as stored; the mark stays.
    }
  }
  return { text: shown, unusual: true };
}
