import type { RejectReason } from "../metrics/m3";
import type { CoreTexts } from "../texts";

import { reasonButtons, rejectReasonText } from "./action-feedback";
import { cutEnd } from "./approval-text";
import { encodeCallback } from "./callback";
import { localDateTime } from "./local-time";
import { MESSAGE_MAX_CHARS, type OutMessage } from "./message";

export type ApprovalEditOutcome =
  | "approved"
  | "approved_held"
  | "rejected"
  | "rejected_reason"
  | "expired"
  | "approved_set"
  | "rejected_set"
  | "went_out"
  | "done"
  | "marked_mistake"
  | "changed"
  | "skipped";

export type HeldBy = "scope" | "paused" | "auth_error" | "host_blocked";

// The edited message: the text and the buttons that stay.
export function approvalEdit(
  input: {
    original: string;
    outcome: ApprovalEditOutcome;
    heldBy?: HeldBy;
    at: Date;
    timeZone: string;
    actionId?: string;
    counts?: { done: number; skipped: number };
    reason?: RejectReason;
    reasonButtons?: boolean;
  },
  texts: CoreTexts
): OutMessage {
  const t = texts.approvals;
  const time = localDateTime(input.at, input.timeZone).time;
  const counts = input.counts ?? { done: 0, skipped: 0 };
  let buttons: OutMessage["buttons"] = [];
  let line: string;
  switch (input.outcome) {
    case "approved":
      line = t.edit.approved(time);
      break;
    case "approved_held": {
      if (input.heldBy === undefined) throw new Error("approved_held needs heldBy");
      line = t.edit.approvedHeld(time, t.held[input.heldBy]);
      // A set has no single send to reject: no button.
      if (input.actionId !== undefined) {
        buttons = [[{ text: t.buttons.reject, data: encodeCallback({ kind: "reject", actionId: input.actionId }) }]];
      }
      break;
    }
    case "rejected":
      line = t.edit.rejected(time);
      // The reason buttons need the action id; a set has none.
      if (input.reasonButtons === true && input.actionId !== undefined) {
        buttons = reasonButtons(input.actionId, texts);
      }
      break;
    case "rejected_reason":
      if (input.reason === undefined) throw new Error("rejected_reason needs reason");
      line = t.edit.rejectedReason(rejectReasonText(input.reason, texts));
      break;
    case "expired":
      line = t.edit.expired(time);
      break;
    case "approved_set":
      line = t.edit.approvedSet(time, counts.done, counts.skipped);
      break;
    case "rejected_set":
      line = t.edit.rejectedSet(time, counts.done, counts.skipped);
      break;
    case "went_out":
      line = t.edit.wentOut(time);
      break;
    case "done":
      line = t.edit.done(time);
      break;
    case "marked_mistake":
      line = t.edit.markedMistake(time);
      break;
    case "changed":
      line = t.edit.changed(time);
      break;
    case "skipped":
      line = t.edit.skipped(time);
      break;
  }
  const tail = `\n\n${line}`;
  const original = cutEnd(input.original, MESSAGE_MAX_CHARS - tail.length);
  return { text: `${original}${tail}`, buttons };
}
