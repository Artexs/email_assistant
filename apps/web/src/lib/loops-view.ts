import {
  DAY_MS,
  LOOP_DEFAULT_FILTER,
  type LoopFilterName,
  loopFilters,
  type LoopItem,
  type LoopKindName,
  loopKinds,
} from "@ea/core/web";

import { t, tp, type TextKey } from "../i18n";
import { ApiError } from "./api";
import { errorText } from "./errors";

// The "Open loops" page is the page `/delegations` while the flag `open_loops` is on. Its tabs are the kinds of
// loop; `?tab=` names the tab and `?filter=` the state filter.
export const LOOP_TABS = loopKinds;
export type LoopTab = LoopKindName;
export const LOOP_DEFAULT_TAB: LoopTab = "delegated";

// The most follow-ups of one loop. The server refuses a third with `limit_reached`.
export const LOOP_FOLLOW_UP_MAX = 2;

// A record: a new kind, filter or close reason breaks the build until it has a text.
export const LOOP_TAB_LABELS: Record<LoopTab, TextKey> = {
  delegated: "lp_tab_delegated",
  waiting: "lp_tab_waiting",
  promised: "lp_tab_promised",
};

export const LOOP_LIST_LABELS: Record<LoopKindName, TextKey> = {
  delegated: "lp_list_delegated",
  waiting: "lp_list_waiting",
  promised: "lp_list_promised",
};

export const LOOP_FILTER_LABELS: Record<LoopFilterName, TextKey> = {
  open: "dgn_filter_open",
  due: "lp_filter_due",
  closed: "dgn_filter_closed",
};

export const LOOP_FILTER_EMPTY: Record<LoopFilterName, TextKey> = {
  open: "lp_empty_open",
  due: "lp_empty_due",
  closed: "lp_empty_closed",
};

export const LOOP_CLOSED_TEXTS: Record<NonNullable<LoopItem["closeReason"]>, TextKey> = {
  replied: "lp_closed_replied",
  replied_subject: "lp_closed_replied_subject",
  done: "lp_closed_done",
  dropped: "lp_closed_dropped",
  untracked: "lp_closed_untracked",
  stale: "lp_closed_stale",
  later_reply: "lp_closed_later_reply",
  expired: "lp_closed_expired",
  sent_off: "lp_closed_sent_off",
};

// No value or an unknown one is the default tab.
export function tabOf(search: string): LoopTab {
  const value = new URLSearchParams(search).get("tab");
  return LOOP_TABS.find((tab) => tab === value) ?? LOOP_DEFAULT_TAB;
}

export function loopFilterOf(search: string): LoopFilterName {
  const value = new URLSearchParams(search).get("filter");
  return loopFilters.find((filter) => filter === value) ?? LOOP_DEFAULT_FILTER;
}

// The default tab keeps the plain address of the delegations page.
export const tabHref = (tab: LoopTab): string =>
  tab === LOOP_DEFAULT_TAB ? "/delegations" : `/delegations?tab=${tab}`;
export const loopFilterHref = (tab: LoopTab, filter: LoopFilterName): string =>
  `/delegations?tab=${tab}&filter=${filter}`;

export type LoopAction = "follow_up" | "later" | "done" | "drop" | "untrack" | "reopen";

type ActionItem = Pick<LoopItem, "kind" | "status" | "closeReason" | "laterLeft" | "followUpWaiting" | "text">;

// Who may do what: Draft follow-up, Drop, Untrack and Reopen are for the owner; Later and Done for any member. A promise has no
// follow-up and no Later; Untrack is for a forward to a delegate; a follow-up that waits for a tap hides Draft follow-up; Later hides
// at 0 left; Reopen needs a closed loop that still has its text (and was not closed by turning Sent tracking off). A suspended
// organization takes no write. The order is the order of the buttons.
export function loopActions(item: ActionItem, who: { owner: boolean; canWrite: boolean }): LoopAction[] {
  if (!who.canWrite) return [];
  if (item.status === "closed") {
    return who.owner && item.text !== null && item.closeReason !== "sent_off" ? ["reopen"] : [];
  }
  const actions: LoopAction[] = [];
  if (who.owner && item.kind !== "promised" && !item.followUpWaiting) actions.push("follow_up");
  if (item.kind !== "promised" && item.laterLeft > 0) actions.push("later");
  actions.push("done");
  if (who.owner) actions.push("drop");
  if (who.owner && item.kind === "delegated") actions.push("untrack");
  return actions;
}

// Why Draft follow-up cannot work, as far as the row shows it. The server also says `too_soon`, `drafts_off` and `suspicious`.
export function followUpBlocked(item: Pick<LoopItem, "followUpsSent">): boolean {
  return item.followUpsSent >= LOOP_FOLLOW_UP_MAX;
}

// The 409 codes of each action and their texts (the codes of `docs/capabilities/open-loops.md` rule 5). A code that is not in the table
// gets the general error.
const CONFLICT_TEXTS: Record<LoopAction, Partial<Record<string, TextKey>>> = {
  follow_up: {
    waiting: "lp_c_waiting",
    closed: "lp_c_closed",
    limit_reached: "lp_c_follow_up_limit",
    too_soon: "lp_c_too_soon",
    suspicious: "lp_c_suspicious",
    drafts_off: "lp_c_drafts_off",
    not_allowed: "lp_c_promised_follow_up",
  },
  later: { closed: "lp_c_closed", limit_reached: "lp_c_later_limit", not_allowed: "lp_c_promised_later" },
  done: { already: "lp_c_already_closed" },
  drop: { already: "lp_c_already_closed" },
  untrack: { already: "lp_c_already_closed", not_allowed: "lp_c_untrack_not_allowed" },
  reopen: { already: "lp_c_already_open", not_allowed: "lp_c_reopen_not_allowed" },
};

// What a failed action does to the page: a text for the status line, or "gone" (the loop does not exist any more).
export type LoopOutcome = { kind: "gone" } | { kind: "notice"; key: TextKey } | { kind: "error"; key: TextKey };

export function loopOutcome(action: LoopAction, error: unknown): LoopOutcome {
  if (error instanceof ApiError) {
    if (error.status === 404) return { kind: "gone" };
    const key = error.status === 409 ? CONFLICT_TEXTS[action][error.code] : undefined;
    if (key !== undefined) return { kind: "notice", key };
  }
  return { kind: "error", key: errorText(error) };
}

// Working days that passed since the wait began: the weekdays after the local date of `sentAt` up to the local date of `now`. A wait of
// one working day started on Friday is 1 on Monday, so the count agrees with how the server adds working days.
export function workingDaysWaited(sentAt: string, now: Date, timeZone: string): number {
  const day = (at: Date): number => {
    const [year = 0, month = 1, date = 1] = new Intl.DateTimeFormat("en-CA", { timeZone })
      .format(at)
      .split("-")
      .map(Number);
    return Date.UTC(year, month - 1, date);
  };
  const from = day(new Date(sentAt));
  const to = day(now);
  let count = 0;
  // A wait of more than a year shows as a year: the cap keeps a bad date from looping long.
  for (let at = from + DAY_MS, steps = 0; at <= to && steps < 400; at += DAY_MS, steps += 1) {
    const weekday = new Date(at).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

function waitText(item: LoopItem, now: Date, timeZone: string): string {
  const days = workingDaysWaited(item.sentAt, now, timeZone);
  return days === 0 ? t("lp_days_less") : tp("lp_working_days", days);
}

// The reason line of a row: why the loop is on the page (open) or how it ended (closed).
export function reasonText(item: LoopItem, now: Date, timeZone: string): string {
  if (item.status === "closed")
    return t(item.closeReason === null ? "lp_status_closed" : LOOP_CLOSED_TEXTS[item.closeReason]);
  if (item.reason === "promised") return t("lp_reason_promised");
  const days = waitText(item, now, timeZone);
  return t(item.reason === "forwarded_to_delegate" ? "lp_reason_forwarded" : "lp_reason_asked", { days });
}

// The name that the buttons of a row carry for a screen reader: who it is about (the delegate, else the counterpart) and what it is
// about (the text, else the subject). The same person often has several loops, so the person alone would give equal button names.
export function loopName(item: Pick<LoopItem, "delegate" | "counterpart" | "text" | "subject">): string {
  const parts = [item.delegate?.name ?? item.counterpart, item.text ?? item.subject].filter(
    (part): part is string => part !== null
  );
  return parts.length === 0 ? t("lp_unnamed") : parts.join(", ");
}

// Adds the next page to the loaded ones. A loop that moved between the pages shows once.
export function mergeLoopPages(loaded: readonly LoopItem[], more: readonly LoopItem[]): LoopItem[] {
  const seen = new Set(loaded.map((item) => item.id));
  return [...loaded, ...more.filter((item) => !seen.has(item.id))];
}
