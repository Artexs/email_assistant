import {
  Activity,
  BarChart3,
  ClipboardList,
  FileCheck,
  Inbox,
  ListFilter,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { TextKey } from "../../i18n";

export type NavKey =
  | "onboarding"
  | "activity"
  | "approvals"
  | "delegations"
  | "mailboxes"
  | "settings"
  | "rules"
  | "operator"
  | "stats";

export interface NavItem {
  key: NavKey;
  href: `/${NavKey}`;
  label: TextKey;
  icon: LucideIcon;
}

const OPEN_LOOPS_FLAG = "open_loops";

// The order of the panel (F102 stages 12 and 18): Activity, Approvals, Delegations, Mailboxes, Settings, Rules, Stats.
// An item with flags shows only while the organization has one of them on (`/api/me` field `features`). The desktop sidebar shows all
// of them. While the flag `open_loops` is on, the Delegations item is the "Open loops" page (F116 stage 21): same address, new label;
// the flag alone also shows it (its tabs Waiting and Promised need no F102 flag).
const ORDER: { item: NavItem; flags: readonly string[] | null }[] = [
  { item: { key: "activity", href: "/activity", label: "nav_activity", icon: Activity }, flags: null },
  {
    item: { key: "approvals", href: "/approvals", label: "nav_approvals", icon: FileCheck },
    flags: ["approvals_page"],
  },
  {
    item: { key: "delegations", href: "/delegations", label: "nav_delegations", icon: Users },
    flags: ["delegation_pages", OPEN_LOOPS_FLAG],
  },
  { item: { key: "mailboxes", href: "/mailboxes", label: "nav_mailboxes", icon: Inbox }, flags: null },
  { item: { key: "settings", href: "/settings", label: "nav_settings", icon: Settings }, flags: null },
  { item: { key: "rules", href: "/rules", label: "nav_rules", icon: ListFilter }, flags: null },
  { item: { key: "stats", href: "/stats", label: "nav_stats", icon: BarChart3 }, flags: ["stats_page"] },
];

// The bottom tab bar of a phone holds at most this many items (its grid has 4 or 5 columns); the rest go to the menu.
export const PHONE_TAB_LIMIT = 5;

// The label of the Delegations item and the title of its page change with the flag `open_loops`.
function labelFor(item: NavItem, features: readonly string[]): TextKey {
  return item.key === "delegations" && features.includes(OPEN_LOOPS_FLAG) ? "nav_open_loops" : item.label;
}

export function navItems(features: readonly string[]): NavItem[] {
  return ORDER.filter((entry) => entry.flags === null || entry.flags.some((flag) => features.includes(flag))).map(
    (entry) => ({ ...entry.item, label: labelFor(entry.item, features) })
  );
}

// The heading of a page: the Delegations page is "Open loops" while the flag is on.
export function pageTitle(active: NavKey, title: TextKey, features: readonly string[]): TextKey {
  return active === "delegations" && features.includes(OPEN_LOOPS_FLAG) ? "title_open_loops" : title;
}

export function phoneTabs(features: readonly string[]): NavItem[] {
  return navItems(features).slice(0, PHONE_TAB_LIMIT);
}

// The items that do not fit in the tab bar: the menu sheet of a phone shows them.
export function phoneOverflow(features: readonly string[]): NavItem[] {
  return navItems(features).slice(PHONE_TAB_LIMIT);
}

// The badge of the approvals item: nothing for 0, the number up to 99, then "99+".
export function approvalsBadge(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : `${count}`;
}

export const ONBOARDING_ITEM: NavItem = {
  key: "onboarding",
  href: "/onboarding",
  label: "nav_onboarding",
  icon: ClipboardList,
};

// Shown after the tabs, only to an operator (`me.operator`).
export const OPERATOR_ITEM: NavItem = {
  key: "operator",
  href: "/operator",
  label: "nav_operator",
  icon: ShieldCheck,
};
