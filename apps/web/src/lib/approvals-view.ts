import {
  approvalConflictSchema,
  MINUTE_MS,
  rejectReasonBodySchema,
  textTables,
  type ApprovalApproveAnswer,
  type ApprovalClosedState,
  type ApprovalConflict,
  type ApprovalDetail,
  type ApprovalEditClosedCode,
  type ApprovalItem,
} from "@ea/core/web";

import type { TextKey } from "../i18n";
import { ApiError } from "./api";
import { errorText } from "./errors";

type State = ApprovalDetail["state"];
type HeldBy = NonNullable<ApprovalItem["heldBy"]>;
type Kind = ApprovalItem["kind"];
type Reason = (typeof REJECT_REASONS)[number];

// The label of every state that the detail route can answer. A record: a new state breaks the build until it has a text.
export const STATE_LABELS: Record<State, TextKey> = {
  waiting: "appr_state_waiting",
  held: "appr_state_held",
  sending: "appr_state_sending",
  sent: "appr_state_sent",
  rejected: "appr_state_rejected",
  expired: "appr_state_expired",
  failed: "appr_state_failed",
  superseded: "appr_state_superseded",
};

export const HELD_TEXTS: Record<HeldBy, TextKey> = {
  scope: "appr_held_scope",
  paused: "appr_held_paused",
  auth_error: "appr_held_auth_error",
  host_blocked: "appr_held_host_blocked",
};

export const KIND_TITLES: Record<Kind, TextKey> = {
  delegation: "appr_title_delegation",
  clarification: "appr_title_clarification",
  reminder: "appr_title_reminder",
  follow_up: "appr_title_follow_up",
  reply: "appr_title_reply",
};

// A send that is `held` with no cause is approved and waits for the next run of the committer: it is no block.
export function stateLabelKey(state: State, heldBy: ApprovalItem["heldBy"]): TextKey {
  if (state === "held" && heldBy === null) return "appr_state_held_soon";
  return STATE_LABELS[state];
}

// "Name <address>", or the address alone.
export function recipientLabel(recipient: { name: string | null; address: string }): string {
  return recipient.name === null || recipient.name === ""
    ? recipient.address
    : `${recipient.name} <${recipient.address}>`;
}

// The view stores the English placeholder for an unknown sender; the page prints it in its own language.
export function isUnknownSender(label: string): boolean {
  return label === textTables.en.common.unknownSender;
}

export interface DurationText {
  key: "appr_dur_min" | "appr_dur_hour" | "appr_dur_day";
  n: number;
}

// The time until a deadline, rounded so the page never promises more time than is left: minutes below an hour, hours below 48 h, then days.
export function durationText(ms: number): DurationText {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE_MS));
  if (minutes < 60) return { key: "appr_dur_min", n: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { key: "appr_dur_hour", n: hours };
  return { key: "appr_dur_day", n: Math.floor(hours / 24) };
}

export const REJECT_REASONS = rejectReasonBodySchema.shape.reason.options;

export const REASON_TEXTS: Record<Reason, TextKey> = {
  wrong_person: "appr_reason_wrong_person",
  wrong_content: "appr_reason_wrong_content",
  not_needed: "appr_reason_not_needed",
};

export interface Decisions {
  approve: boolean;
  reject: boolean;
}

// Only an owner decides, and not in a paused organization. A waiting send can be approved or rejected; a held send is approved already, so it can only be rejected.
export function decisions(
  detail: Pick<ApprovalDetail, "state">,
  who: { owner: boolean; canWrite: boolean }
): Decisions {
  const may = who.owner && who.canWrite;
  return {
    approve: may && detail.state === "waiting",
    reject: may && (detail.state === "waiting" || detail.state === "held"),
  };
}

const CLOSED_TEXTS: Record<ApprovalClosedState | ApprovalEditClosedCode, TextKey> = {
  held: "appr_closed_held",
  sending: "appr_closed_sending",
  sent: "appr_closed_sent",
  rejected: "appr_closed_rejected",
  expired: "appr_closed_expired",
  failed: "appr_closed_failed",
  payload_gone: "appr_closed_payload_gone",
  draft_gone: "appr_closed_draft_gone",
  delegation_closed: "appr_closed_delegation_closed",
  loop_closed: "appr_closed_loop_closed",
};

// One text per closed-state name and per edit code (`payload_gone`, `draft_gone`, `delegation_closed`). A missing name gets a general text.
export function closedTextKey(state: ApprovalConflict["state"]): TextKey {
  return state === undefined ? "appr_closed_other" : CLOSED_TEXTS[state];
}

export interface Message {
  key: TextKey;
  // The held cause, for `appr_done_held`.
  reason?: TextKey;
}

// What the page says after an approve. The state and the cause come from the detail that the page read after the approve:
// the answer alone never promises a send (a second call answers `approved` for a send that is held). The cause of the answer
// counts only when the detail has none, so a message never says "sending" where the answer named a cause.
export function approveMessage(detail: ApprovalDetail | null, answer: ApprovalApproveAnswer): Message {
  if (detail === null) return { key: "appr_done_unknown" };
  switch (detail.state) {
    case "sent":
      return { key: "appr_done_sent" };
    case "sending":
      return { key: "appr_done_sending" };
    case "held": {
      const cause = detail.heldBy ?? answer.heldBy;
      return cause === undefined ? { key: "appr_done_sending" } : { key: "appr_done_held", reason: HELD_TEXTS[cause] };
    }
    case "failed":
      return { key: "appr_done_failed" };
    case "rejected":
      return { key: "appr_closed_rejected" };
    case "expired":
      return { key: "appr_closed_expired" };
    case "waiting":
    case "superseded":
      return { key: "appr_done_unknown" };
  }
}

// The answer of a failed decision, as the page acts on it.
export type FailureOutcome =
  | { kind: "changed"; currentId: string } // load the newest version
  | { kind: "notice"; key: TextKey } // say it and reload the list and the item
  | { kind: "gone" } // the send does not exist (any more)
  | { kind: "error"; key: TextKey }; // the existing error banner

export function failureOutcome(error: unknown): FailureOutcome {
  if (!(error instanceof ApiError)) return { kind: "error", key: errorText(error) };
  if (error.status === 404) return { kind: "gone" };
  if (error.status !== 409) return { kind: "error", key: errorText(error) };
  const conflict = approvalConflictSchema.safeParse(error.raw);
  if (!conflict.success) return { kind: "error", key: errorText(error) };
  switch (conflict.data.error) {
    case "changed":
      return conflict.data.currentId === undefined
        ? { kind: "notice", key: "appr_changed" }
        : { kind: "changed", currentId: conflict.data.currentId };
    case "draft_not_ready":
      return { kind: "notice", key: "appr_draft_not_ready" };
    case "has_gaps":
      return { kind: "notice", key: "appr_has_gaps" };
    case "feature_off":
      return { kind: "notice", key: "appr_feature_off" };
    case "closed":
      return { kind: "notice", key: closedTextKey(conflict.data.state) };
    case "drafts_off":
      return { kind: "error", key: errorText(error) };
  }
}
