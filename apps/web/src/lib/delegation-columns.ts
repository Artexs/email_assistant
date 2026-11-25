import type { DelegationFilter, DelegationItem } from "@ea/core/web";
import { AlertTriangle, Archive, CheckCircle2, Clock, Send, type LucideIcon } from "lucide-react";

import type { TextKey } from "../i18n";
import type { DelegationStatus } from "./delegations-view";

export type DelegationColumn = "overdue" | "drafted" | "sent" | "answered";
// A column, or the closed list under the columns.
export type DelegationGroup = DelegationColumn | "closed";

// The page order of the columns (a phone stacks them in this order).
export const DELEGATION_COLUMNS: readonly DelegationColumn[] = ["overdue", "drafted", "sent", "answered"];

// The page order of all groups: a row that two feeds hold goes to the first group of this order.
const GROUP_ORDER: readonly DelegationGroup[] = [...DELEGATION_COLUMNS, "closed"];

// A record: a new status breaks the build until it has a group.
export const DELEGATION_GROUP_OF: Record<DelegationStatus, DelegationGroup> = {
  drafted: "drafted",
  sent: "sent",
  overdue: "overdue",
  answered: "answered",
  done: "closed",
  cancelled: "closed",
};

// The list filter that loads the rows of a group. Drafted and sent share the open list.
export const GROUP_FEED: Record<DelegationGroup, DelegationFilter> = {
  overdue: "overdue",
  drafted: "open",
  sent: "open",
  answered: "answered",
  closed: "closed",
};

// One look per column. `tone` is a whole class name, written out in full so the build keeps it.
export const COLUMN_LOOK: Record<DelegationColumn, { title: TextKey; empty: TextKey; icon: LucideIcon; tone: string }> =
  {
    overdue: { title: "dgn_col_overdue", empty: "dgn_col_empty_overdue", icon: AlertTriangle, tone: "text-cat-urgent" },
    drafted: { title: "dgn_col_drafted", empty: "dgn_col_empty_drafted", icon: Send, tone: "text-primary" },
    sent: { title: "dgn_col_sent", empty: "dgn_col_empty_sent", icon: Clock, tone: "text-cat-needs-reply" },
    answered: {
      title: "dgn_col_answered",
      empty: "dgn_col_empty_answered",
      icon: CheckCircle2,
      tone: "text-cat-notification",
    },
  };

// The closed list under the columns: done and cancelled delegations.
export const CLOSED_LOOK: { title: TextKey; empty: TextKey; icon: LucideIcon; tone: string } = {
  title: "dgn_col_closed",
  empty: "dgn_empty_closed",
  icon: Archive,
  tone: "text-muted-foreground",
};

const FEED_ORDER: readonly DelegationFilter[] = ["overdue", "open", "answered", "closed"];

// Puts each loaded row in the group of its status, in the order the server sent. A row that two feeds hold shows once: the feeds are read
// in page order, so it goes to the first group.
export function placeRows(
  feeds: Partial<Record<DelegationFilter, readonly DelegationItem[]>>
): Record<DelegationGroup, DelegationItem[]> {
  const groups: Record<DelegationGroup, DelegationItem[]> = {
    overdue: [],
    drafted: [],
    sent: [],
    answered: [],
    closed: [],
  };
  const placed = new Set<string>();
  for (const feed of FEED_ORDER) {
    for (const item of feeds[feed] ?? []) {
      if (placed.has(item.id)) continue;
      placed.add(item.id);
      groups[DELEGATION_GROUP_OF[item.status]].push(item);
    }
  }
  return groups;
}

// What the focus does after a reload: nothing was focused, the focused row is still on the page (it may sit in another column now), or
// it is gone and the status line takes the focus.
export function focusAfterReload(
  focusedId: string | null,
  groups: Record<DelegationGroup, readonly DelegationItem[]>
): "row" | "status" | null {
  if (focusedId === null) return null;
  return GROUP_ORDER.some((group) => groups[group].some((item) => item.id === focusedId)) ? "row" : "status";
}
