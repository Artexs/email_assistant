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

// The order of the panel (F102 stages 12 and 18): Activity, Approvals, Delegations, Mailboxes, Settings, Rules, Stats.
// An item with a `flag` shows only while the organization has that feature on (`/api/me` field `features`). The desktop sidebar shows all of them.
const ORDER: { item: NavItem; flag: string | null }[] = [
  { item: { key: "activity", href: "/activity", label: "nav_activity", icon: Activity }, flag: null },
  { item: { key: "approvals", href: "/approvals", label: "nav_approvals", icon: FileCheck }, flag: "approvals_page" },
  {
    item: { key: "delegations", href: "/delegations", label: "nav_delegations", icon: Users },
    flag: "delegation_pages",
  },
  { item: { key: "mailboxes", href: "/mailboxes", label: "nav_mailboxes", icon: Inbox }, flag: null },
  { item: { key: "settings", href: "/settings", label: "nav_settings", icon: Settings }, flag: null },
  { item: { key: "rules", href: "/rules", label: "nav_rules", icon: ListFilter }, flag: null },
  { item: { key: "stats", href: "/stats", label: "nav_stats", icon: BarChart3 }, flag: "stats_page" },
];

// The bottom tab bar of a phone holds at most this many items (its grid has 4 or 5 columns); the rest go to the menu.
export const PHONE_TAB_LIMIT = 5;

export function navItems(features: readonly string[]): NavItem[] {
  return ORDER.filter((entry) => entry.flag === null || features.includes(entry.flag)).map((entry) => entry.item);
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
