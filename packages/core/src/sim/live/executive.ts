import { type Callback, parseCallback } from "../../digest/callback";
import { localDateTime, localToInstant } from "../../digest/local-time";
import { MINUTE_MS } from "../../time";
import type { Category } from "../../triage/categories";
import { createRng } from "../random";

import { addDays, isoWeekday } from "./calendar-days";

// The rules of the scripted executive of the live lab: which button of a Telegram card the executive presses.
// Pure: the driver reads the fake Telegram and the slot truth, and calls these functions. The executive only
// approves, rejects (with a reason) and undoes. It never relabels and never edits a draft.
const ZONE = "Europe/Warsaw";
const MIN_DELAY_MIN = 5;
const MAX_DELAY_MIN = 90;

export type ExecCardKind = "approval" | "reminder_set" | "send_failed" | "reject_reason" | "feedback" | "other";

export interface ExecCard {
  kind: ExecCardKind;
  messageId: number; // the Telegram message that holds the buttons
  buttons: string[]; // callback data of this card only, as parseCallback reads it
  actionId?: string;
  setId?: string;
  emailId?: string;
  draft?: { kind: "delegation" | "clarification" | "other"; recipient: string };
  moved?: boolean; // the card reports an automatic move out of the INBOX
}

export interface ExecTruthInfo {
  category: Category;
  expectedDraft?: "delegation" | "clarification" | "none";
  expectedDelegateAddress?: string;
}

// null: the mail of the card is not a lab mail of this run.
export type ExecTruth = ExecTruthInfo | null;

export type ExecAction =
  | { press: string; then?: "reason_wrong_person" | "reason_not_needed" }
  | { press: null; count?: "unmapped" | "no_rule" };

export interface ExecMemory {
  sentAgain: boolean; // the executive pressed "send again" for this action already
  pendingReason?: "p" | "n"; // the reason the executive planned for the reject; the driver keeps it in the tap_planned event
}

const NO_RULE: ExecAction = { press: null, count: "no_rule" };
const UNMAPPED: ExecAction = { press: null, count: "unmapped" };
const NO_PRESS: ExecAction = { press: null };
const UNDO_CATEGORIES: readonly Category[] = ["urgent", "needs_reply", "delegation"];

// The button of the card with this prefix ("ap", "rw:p", ...). The rules press only buttons the card holds.
function buttonWith(card: ExecCard, prefix: string): string | undefined {
  return card.buttons.find((data) => data.startsWith(`${prefix}:`));
}

function press(card: ExecCard, prefix: string, then?: "reason_wrong_person" | "reason_not_needed"): ExecAction {
  const data = buttonWith(card, prefix);
  if (data === undefined) return NO_RULE;
  return then === undefined ? { press: data } : { press: data, then };
}

function decideApproval(card: ExecCard, truth: ExecTruthInfo): ExecAction {
  const draft = card.draft;
  // No draft read: the executive cannot judge it, so it presses nothing.
  if (draft === undefined) return NO_RULE;
  if (draft.kind === "delegation") {
    // A delegation draft for a mail that needs none is "not needed", never "wrong person".
    if (truth.category !== "delegation") return press(card, "ar", "reason_not_needed");
    const expected = truth.expectedDelegateAddress?.toLowerCase();
    if (expected !== undefined && draft.recipient.toLowerCase() === expected) return press(card, "ap");
    return press(card, "ar", "reason_wrong_person");
  }
  if (draft.kind === "clarification") {
    return truth.expectedDraft === "clarification" ? press(card, "ap") : press(card, "ar", "reason_not_needed");
  }
  return press(card, "ar", "reason_not_needed");
}

// Rules, first match wins (`docs/capabilities/live-lab.md`).
export function executiveDecision(card: ExecCard, truth: ExecTruth, memory: ExecMemory): ExecAction {
  if (truth === null) return UNMAPPED;
  switch (card.kind) {
    case "approval":
      return decideApproval(card, truth);
    case "reject_reason":
      return memory.pendingReason === undefined ? NO_RULE : press(card, `rw:${memory.pendingReason}`);
    case "reminder_set":
      return press(card, "as");
    case "send_failed":
      return memory.sentAgain ? NO_PRESS : press(card, "ag");
    case "feedback":
      if (card.moved === true && UNDO_CATEGORIES.includes(truth.category)) {
        const undo = buttonWith(card, "fu");
        if (undo !== undefined) return { press: undo };
      }
      return NO_PRESS;
    default:
      return NO_RULE;
  }
}

// The start of the executive's hours on a Warsaw date: weekdays 08:00-18:00, weekends 10:00-11:00.
function windowOf(date: string): { start: string; end: string } {
  return isoWeekday(date) <= 5 ? { start: "08:00", end: "18:00" } : { start: "10:00", end: "11:00" };
}

// The instant the executive starts to look at a card: `cardAt` when it lies in the hours, else the next start.
function startPoint(cardAt: Date): Date {
  const local = localDateTime(cardAt, ZONE);
  const window = windowOf(local.date);
  if (local.time >= window.start && local.time < window.end) return cardAt;
  if (local.time < window.start) return localToInstant(local.date, window.start, ZONE);
  const nextDate = addDays(local.date, 1);
  return localToInstant(nextDate, windowOf(nextDate).start, ZONE);
}

// UTC ISO of the tap: the start point plus 5 to 90 minutes (seeded). The tap may fall after the window end.
// The longest gap between two windows (Saturday 11:00 to Sunday 10:00) is 23 h, inside the 48 h approval time.
export function executiveTapAt(cardAt: string, seed: number): string {
  const at = new Date(cardAt);
  if (Number.isNaN(at.getTime())) throw new Error("executiveTapAt needs an ISO instant");
  const rng = createRng(seed);
  const delayMs = MIN_DELAY_MIN * MINUTE_MS + rng.int((MAX_DELAY_MIN - MIN_DELAY_MIN) * MINUTE_MS + 1);
  return new Date(startPoint(at).getTime() + delayMs).toISOString();
}

const KIND_ORDER: ExecCardKind[] = ["reject_reason", "approval", "reminder_set", "send_failed", "feedback", "other"];

function kindOf(callback: Callback): ExecCardKind {
  switch (callback.kind) {
    case "reject_reason":
      return "reject_reason";
    case "approve":
    case "reject":
      return "approval";
    case "approve_set":
    case "reject_set":
      return "reminder_set";
    case "send_again":
    case "went_out":
      return "send_failed";
    case "right":
    case "pick":
    case "edit":
    case "cancel":
    case "undo":
      return "feedback";
    default:
      return "other";
  }
}

function idOf(callback: Callback): string | undefined {
  if ("actionId" in callback) return callback.actionId;
  if ("setId" in callback) return callback.setId;
  if ("emailId" in callback) return callback.emailId;
  return "delegationId" in callback ? callback.delegationId : undefined;
}

// One message can hold buttons for many mails (a digest): one card per id in the button data.
// A button that parseCallback does not read is not part of any card. `draft` and `moved` stay unset: the driver reads them.
export function cardsOf(messageId: number, buttons: string[]): ExecCard[] {
  const groups = new Map<string, { buttons: string[]; kind: ExecCardKind; callback: Callback }>();
  for (const data of buttons) {
    const callback = parseCallback(data);
    const id = callback === null ? undefined : idOf(callback);
    if (callback === null || id === undefined) continue;
    const kind = kindOf(callback);
    const group = groups.get(id);
    if (group === undefined) {
      groups.set(id, { buttons: [data], kind, callback });
      continue;
    }
    group.buttons.push(data);
    if (KIND_ORDER.indexOf(kind) < KIND_ORDER.indexOf(group.kind)) {
      group.kind = kind;
      group.callback = callback;
    }
  }
  return [...groups.entries()].map(([id, group]): ExecCard => {
    const card: ExecCard = { kind: group.kind, messageId, buttons: group.buttons };
    if (group.kind === "reminder_set") card.setId = id;
    else if (group.kind === "feedback") card.emailId = id;
    else if (group.kind !== "other") card.actionId = id;
    return card;
  });
}
