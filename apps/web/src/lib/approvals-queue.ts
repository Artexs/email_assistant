import {
  approvalConflictSchema,
  type ApprovalApproveAnswer,
  type ApprovalDetail,
  type ApprovalItem,
} from "@ea/core/web";

import type { TextKey } from "../i18n";
import { ApiError } from "./api";
import { approveMessage, closedTextKey, failureOutcome, stateLabelKey, type Message } from "./approvals-view";
import { endReasonKey } from "./replies-view";

// Every rule of the one-draft-at-a-time queue, pure: no React, no texts, no clock (the caller passes the time).

// How long a card stays on screen, with its decision buttons off, after an outcome.
export const SENT_HOLD_MS = 1500;
// How long the decision buttons of a new card stay off, so a double tap cannot hit the next draft.
export const ARM_MS = 500;

// `skipped`: ids the user passed with "Later" on this page. `ownIds`: ids this page approved, rejected, replaced with a new version or saw leave.
type Ids = ReadonlySet<string>;

// The waiting drafts in list order. A held draft is already approved, so it is no part of the queue.
export function queueIds(items: readonly ApprovalItem[], skipped: readonly string[], ownIds: Ids): string[] {
  return items
    .filter((item) => item.state === "waiting" && !skipped.includes(item.id) && !ownIds.has(item.id))
    .map((item) => item.id);
}

// The draft to show next, or null: the end card (only skipped drafts are left) or the empty page.
export function nextFocus(
  items: readonly ApprovalItem[],
  from: { leaving: string | null; skipped: readonly string[]; ownIds: Ids }
): string | null {
  return queueIds(items, from.skipped, from.ownIds).find((id) => id !== from.leaving) ?? null;
}

// "Draft 2 of 5". `done` counts the approves and rejects of this page load; `waiting` counts the waiting drafts that this page did not decide, skipped ones included.
export function progress(counts: { done: number; waiting: number }): { current: number; total: number } {
  return { current: counts.done + 1, total: counts.done + counts.waiting };
}

// The focused draft left the list or changed its state, and this page did not cause it (another device did).
export function vanished(
  items: readonly ApprovalItem[],
  focus: { id: string; openedAs: "waiting" | "held" },
  ownIds: Ids
): boolean {
  if (ownIds.has(focus.id)) return false;
  const found = items.find((item) => item.id === focus.id);
  return found === undefined || found.state !== focus.openedAs;
}

// The decision buttons of a card turn on after `ARM_MS`. Every change of the focused id restarts the time, also a version swap in place.
export function armed(nowMs: number, cardShownAtMs: number): boolean {
  return nowMs - cardShownAtMs >= ARM_MS;
}

export function expiredNow(item: { expiresAt: string | null }, now: Date): boolean {
  return item.expiresAt !== null && now.getTime() >= Date.parse(item.expiresAt);
}

// What a decision did, as the page acts on it.
export type DecisionResult =
  | { kind: "approved"; answer: ApprovalApproveAnswer; detail: ApprovalDetail | null } // `detail`: read after the approve, null when unreadable
  | { kind: "rejected"; mistakeCapture: boolean }
  | { kind: "failed"; error: unknown };

export interface Outcome {
  text: Message;
  // hold: show the text with the buttons off, then the next card; next-button: show the text and a "Next" button;
  // stay: show the text on the same card; reason: ask for the reject reason.
  then: "hold" | "next-button" | "stay" | "reason";
  // Open this draft in place (the newest version of a changed draft).
  openId?: string;
}

function isClosedConflict(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  const conflict = approvalConflictSchema.safeParse(error.raw);
  return conflict.success && conflict.data.error === "closed";
}

export function outcomeOf(result: DecisionResult): Outcome {
  if (result.kind === "rejected") {
    return { text: { key: "appr_done_rejected" }, then: result.mistakeCapture ? "reason" : "hold" };
  }
  if (result.kind === "approved") {
    const text = approveMessage(result.detail, result.answer);
    const state = result.detail?.state;
    const stays = state === undefined || state === "failed" || state === "waiting" || state === "superseded";
    return { text, then: stays ? "next-button" : "hold" };
  }
  const failure = failureOutcome(result.error);
  switch (failure.kind) {
    case "changed":
      return { text: { key: "appr_changed" }, then: "stay", openId: failure.currentId };
    case "gone":
      return { text: { key: "appr_not_found" }, then: "hold" };
    case "notice":
      return { text: { key: failure.key }, then: isClosedConflict(result.error) ? "hold" : "stay" };
    case "error":
      return { text: { key: failure.key }, then: "stay" };
  }
}

export interface ClosedView {
  state: TextKey;
  reason?: TextKey;
  // The newest version of a replaced draft.
  newest?: string;
}

// The closed card of a draft that is not waiting or held: its state, why the system closed it, and the newer version.
export function closedView(detail: ApprovalDetail): ClosedView {
  const view: ClosedView = { state: stateLabelKey(detail.state, detail.heldBy) };
  const reason = endReasonKey(detail);
  if (reason !== null) view.reason = reason;
  if (detail.state === "superseded" && detail.currentId !== null) view.newest = detail.currentId;
  return view;
}

const SEND_CLOSED_STATES = ["held", "sending", "sent", "rejected", "expired", "failed"] as const;

// The text of a send that left the queue: it was approved, sent, rejected, expired or failed. A draft that waits or was replaced has none.
export function closedSendKey(state: ApprovalDetail["state"]): TextKey | null {
  const closed = SEND_CLOSED_STATES.find((candidate) => candidate === state);
  return closed === undefined ? null : closedTextKey(closed);
}

// The same question for a text that the edit dialog or a conflict gave.
export function isClosedSendKey(key: TextKey): boolean {
  return SEND_CLOSED_STATES.some((state) => closedTextKey(state) === key);
}
