import { type RejectReason, rejectReasons } from "../metrics/m3";
import type { CoreTexts } from "../texts";

import { encodeCallback } from "./callback";
import type { OutMessage } from "./message";

// The reason words and the button texts are entries of `texts.approvals` (en and pl, plan D31).
export function rejectReasonText(reason: RejectReason, texts: CoreTexts): string {
  return texts.approvals.reasons[reason];
}

// One row of three buttons under a rejected card: wrong person, wrong content, not needed.
export function reasonButtons(actionId: string, texts: CoreTexts): OutMessage["buttons"] {
  const labels: Record<RejectReason, string> = {
    wrong_person: texts.approvals.buttons.reasonWrongPerson,
    wrong_content: texts.approvals.buttons.reasonWrongContent,
    not_needed: texts.approvals.buttons.reasonNotNeeded,
  };
  return [
    rejectReasons.map((reason) => ({
      text: labels[reason],
      data: encodeCallback({ kind: "reject_reason", reason, actionId }),
    })),
  ];
}

// One button under a sent result: the owner marks the send as a mistake.
export function mistakeButton(actionId: string, texts: CoreTexts): OutMessage["buttons"] {
  return [[{ text: texts.approvals.buttons.mistake, data: encodeCallback({ kind: "mistake", actionId }) }]];
}
