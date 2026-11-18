// The report page. Pure: a `TrustView` in, fixed phrases and counts out.
// The page shows counts and fixed phrases only. The view also holds example mails (sender name and subject, for the panel review of
// stage 15); nothing here reads them, and no function of this file takes them: mail text never reaches the report.
import type { MailboxView, TrustView } from "@ea/core/web";

import type { TextKey } from "../i18n";

export type ReportCategory = keyof TrustView["examples"];

// The categories that have a history check and a recommendation (`movingCategories` of the core).
export const REPORT_CATEGORIES = ["info", "notification", "spam"] as const satisfies readonly ReportCategory[];

// The checks that are still open: the page polls while one of these is the newest.
type Check = NonNullable<TrustView["check"]>;
const OPEN_STATUSES: readonly Check["status"][] = ["queued", "backfilling", "waiting_flags", "classifying"];

// The history sample of one check; the progress line says "of up to".
export const REPORT_SAMPLE_MAX = 500;

export type ReportState =
  | { kind: "starting" }
  | { kind: "running"; checked: number }
  | { kind: "no_result"; reasonKey: TextKey }
  | { kind: "done"; capped: boolean };

const NO_RESULT_KEYS = {
  no_history: "rep_nr_no_history",
  uidvalidity: "rep_nr_uidvalidity",
  cost_unknown: "rep_nr_cost_unknown",
  stopped: "rep_nr_stopped",
  key_changed: "rep_nr_key_changed",
  auth_refused: "rep_nr_auth_refused",
  model_failing: "rep_nr_model_failing",
} as const satisfies Record<NonNullable<Check["noResultReason"]>, TextKey>;

// One state per view: no check yet, a check that runs, an end without a result (one sentence per reason), a result.
export function reportState(view: TrustView): ReportState {
  const { check } = view;
  if (check === null) return { kind: "starting" };
  if (OPEN_STATUSES.includes(check.status)) return { kind: "running", checked: check.checked };
  if (check.status === "no_result") {
    return {
      kind: "no_result",
      reasonKey: check.noResultReason === null ? "rep_nr_stopped" : NO_RESULT_KEYS[check.noResultReason],
    };
  }
  return { kind: "done", capped: check.capped };
}

// The page polls every 30 s while a check is open or has not started (no live updates: F055 is out of scope).
export function shouldPoll(view: TrustView | null): boolean {
  if (view === null) return true;
  const state = reportState(view).kind;
  return state === "starting" || state === "running";
}

// The categories that "Turn on recommended" would turn on now: recommended by the evidence and not on. `auto` of the view is what
// triage reads under the running key, as the server filter reads it (`turnOnRecommended`).
export function dueCategories(view: TrustView): ReportCategory[] {
  return REPORT_CATEGORIES.filter((category) => {
    const row = view.categories[category];
    return row.evidence.recommended && !row.auto;
  });
}

export type RecommendationNote = "none" | "all_on" | null;

// The sentence under the categories when nothing is due: everything recommended is on already, or nothing is recommended.
export function recommendationNote(view: TrustView): RecommendationNote {
  if (dueCategories(view).length > 0) return null;
  const recommendedOn = REPORT_CATEGORIES.some((category) => {
    const row = view.categories[category];
    return row.evidence.recommended && row.auto;
  });
  return recommendedOn ? "all_on" : "none";
}

// The button shows for an owner, in a state that has a recommendation (`done`, `no_result`), when at least one category is due.
export function showTurnOn(view: TrustView, isOwner: boolean): boolean {
  const kind = reportState(view).kind;
  return isOwner && (kind === "done" || kind === "no_result") && dueCategories(view).length > 0;
}

// "Check again" is for an owner, in an end state; a check that is open hides it.
export function showCheckAgain(view: TrustView, isOwner: boolean): boolean {
  const kind = reportState(view).kind;
  return isOwner && (kind === "done" || kind === "no_result");
}

// The category blocks show in the two end states (for `no_result` they carry the global proof and the "not enough history" line),
// never while the check runs.
export function showCategories(view: TrustView): boolean {
  const kind = reportState(view).kind;
  return kind === "done" || kind === "no_result";
}

// The mailbox the page shows: the one in `?mailbox=` when it is listed, else the newest connected one (null: none).
export function pickReportMailbox(list: readonly MailboxView[], query: string | null): MailboxView | null {
  const asked = query === null ? undefined : list.find((item) => item.id === query);
  if (asked !== undefined) return asked;
  let newest: MailboxView | null = null;
  for (const item of list) {
    if (newest === null || item.createdAt > newest.createdAt) newest = item;
  }
  return newest;
}
