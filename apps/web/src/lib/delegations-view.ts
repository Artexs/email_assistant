import { DELEGATION_REMINDER_LIMIT, type DelegationItem } from "@ea/core/web";

import type { TextKey } from "../i18n";
import { ApiError } from "./api";
import { errorText } from "./errors";

export { DELEGATION_REMINDER_LIMIT };

export type DelegationStatus = DelegationItem["status"];

// A record: a new status breaks the build until it has a text.
export const STATUS_LABELS: Record<DelegationStatus, TextKey> = {
  drafted: "act_dlg_drafted",
  sent: "act_dlg_sent",
  answered: "act_dlg_answered",
  overdue: "act_dlg_overdue",
  done: "act_dlg_done",
  cancelled: "act_dlg_cancelled",
};

// The page reads `?filter=` once, at load: `closed` opens the closed list. Every other value changes nothing, and the page writes no address.
export const closedOnLoad = (search: string): boolean => new URLSearchParams(search).get("filter") === "closed";

export type DelegationAction = "remind" | "done" | "cancel";

// Who may do what: Remind now and Cancel are for the owner, Done for any member. A suspended organization takes no write.
// The order is the order of the buttons.
export function delegationActions(
  status: DelegationStatus,
  who: { owner: boolean; canWrite: boolean }
): DelegationAction[] {
  if (!who.canWrite) return [];
  const actions: DelegationAction[] = [];
  if (who.owner && (status === "sent" || status === "overdue")) actions.push("remind");
  if (status === "answered" || status === "overdue") actions.push("done");
  if (who.owner && (status === "drafted" || status === "sent" || status === "overdue")) actions.push("cancel");
  return actions;
}

// The five 409 codes of POST /api/delegations/:id/remind.
export const REMIND_BLOCKS = [
  "not_open",
  "limit_reached",
  "reminder_waiting",
  "drafts_off",
  "delegate_inactive",
] as const;
export type RemindBlock = (typeof REMIND_BLOCKS)[number];

export const REMIND_BLOCK_TEXTS: Record<RemindBlock, TextKey> = {
  not_open: "dgn_remind_not_open",
  limit_reached: "dgn_remind_limit_reached",
  reminder_waiting: "dgn_remind_reminder_waiting",
  drafts_off: "dgn_remind_drafts_off",
  delegate_inactive: "dgn_remind_delegate_inactive",
};

// Why Remind now cannot work, as far as the row shows it; null when it can. The order is the order of the server checks. `drafts_off`
// is the setting of the mailbox, which the row does not carry: only the server answer tells it (`remindBlockOf`).
export function remindBlock(item: DelegationItem): RemindBlock | null {
  if (item.status !== "sent" && item.status !== "overdue") return "not_open";
  if (item.remindersSent >= DELEGATION_REMINDER_LIMIT) return "limit_reached";
  if (item.reminderWaiting) return "reminder_waiting";
  if (!item.delegate.active) return "delegate_inactive";
  return null;
}

// What a failed action does to the page: a text for the status line, "gone" (the delegation does not exist any more), or the general error.
// `block` (remind only) also tells the row why the button is off now.
export type ActionOutcome =
  | { kind: "gone" }
  | { kind: "notice"; key: TextKey; block?: RemindBlock }
  | { kind: "error"; key: TextKey };

function isRemindBlock(code: string): code is RemindBlock {
  return (REMIND_BLOCKS as readonly string[]).includes(code);
}

export function remindOutcome(error: unknown): ActionOutcome {
  if (error instanceof ApiError) {
    if (error.status === 404) return { kind: "gone" };
    if (error.status === 409 && isRemindBlock(error.code)) {
      return { kind: "notice", key: REMIND_BLOCK_TEXTS[error.code], block: error.code };
    }
  }
  return { kind: "error", key: errorText(error) };
}

export function doneOutcome(error: unknown): ActionOutcome {
  if (error instanceof ApiError) {
    if (error.status === 404) return { kind: "gone" };
    if (error.status === 409 && error.code === "already") return { kind: "notice", key: "dgn_closed" };
    if (error.status === 409 && error.code === "not_closable") return { kind: "notice", key: "dgn_done_not_closable" };
  }
  return { kind: "error", key: errorText(error) };
}

export function cancelOutcome(error: unknown): ActionOutcome {
  if (error instanceof ApiError) {
    if (error.status === 404) return { kind: "gone" };
    if (error.status === 409 && error.code === "sending") return { kind: "notice", key: "dgn_cancel_sending" };
    if (error.status === 409 && error.code === "not_open") return { kind: "notice", key: "dgn_closed" };
  }
  return { kind: "error", key: errorText(error) };
}

export const approvalLink = (sendId: string): string => `/approvals?id=${encodeURIComponent(sendId)}`;

// The due date as a calendar day of the organization, in the language of the page.
export function dueText(dueAt: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium" }).format(new Date(dueAt));
}

// Adds the next page to the loaded ones. A delegation that moved between the pages shows once.
export function mergePages(loaded: readonly DelegationItem[], more: readonly DelegationItem[]): DelegationItem[] {
  const seen = new Set(loaded.map((item) => item.id));
  return [...loaded, ...more.filter((item) => !seen.has(item.id))];
}
