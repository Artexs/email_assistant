import type { ApprovalList } from "@ea/core/web";
import { useEffect, useState } from "react";

import type { TextKey } from "../../i18n";
import { fetchApproval } from "../../lib/approvals-api";
import type { Notice } from "../../lib/approvals-notice";
import { armed, ARM_MS, type Outcome } from "../../lib/approvals-queue";
import { failureOutcome } from "../../lib/approvals-view";

const PHONE_QUERY = "(max-width: 1023px)";

export interface QueueList {
  data: ApprovalList | null;
  error: unknown;
  loading: boolean;
  reload(): void;
}

// What the decision bar shows. `deciding`: the request runs. `outcome`: the answer, with the buttons gone; `then` says how it ends:
// `hold` moves on by itself, `next-button` waits for "Next draft", `reason` asks why a draft was rejected (`saved`: it was answered).
export type Phase =
  | { kind: "idle" }
  | { kind: "deciding"; id: string }
  | { kind: "outcome"; id: string; notice: Notice; then: Outcome["then"]; saved: boolean };

export async function loadDetail(id: string | null) {
  return { id, detail: id === null ? null : await fetchApproval(id) };
}

// An approved send names where it goes; the other texts have no recipient.
export function noticeOf(text: Outcome["text"], to: string): Notice {
  const notice: Notice = { tone: "info", key: text.key };
  if (text.reason !== undefined) notice.reason = text.reason;
  if (text.key === "appr_done_sent" || text.key === "appr_done_sending") notice.to = to;
  return notice;
}

export function isPhone(): boolean {
  return typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;
}

// The text of a failed reason save: the error text, or "does not exist" when the send is gone.
export function failureKey(error: unknown): TextKey {
  const outcome = failureOutcome(error);
  return outcome.kind === "error" ? outcome.key : "appr_not_found";
}

// The decision buttons of a card turn on `ARM_MS` after it showed. Every change of the open id first switches the buttons off, so a
// draft that comes back after another card or after no card waits again. Returns the cleanup that stops the timer.
export function scheduleArm(openId: string | null, setArmedId: (id: string | null) => void): () => void {
  setArmedId(null);
  if (openId === null) return () => undefined;
  const shownAt = Date.now();
  let timer: ReturnType<typeof setTimeout> = setTimeout(function check() {
    if (armed(Date.now(), shownAt)) setArmedId(openId);
    else timer = setTimeout(check, 20);
  }, ARM_MS);
  return () => clearTimeout(timer);
}

export function useArmed(openId: string | null): boolean {
  const [armedId, setArmedId] = useState<string | null>(null);
  useEffect(() => scheduleArm(openId, setArmedId), [openId]);
  return openId !== null && armedId === openId;
}
