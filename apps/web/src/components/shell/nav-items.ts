import {
  Activity,
  BarChart3,
  ClipboardList,
  Inbox,
  ListFilter,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import type { TextKey } from "../../i18n";

export type NavKey = "onboarding" | "activity" | "mailboxes" | "settings" | "rules" | "operator" | "stats";

export interface NavItem {
  key: NavKey;
  href: `/${NavKey}`;
  label: TextKey;
  icon: LucideIcon;
}

// The bottom tabs on a phone and the sidebar body on a desktop.
export const TAB_ITEMS: NavItem[] = [
  { key: "activity", href: "/activity", label: "nav_activity", icon: Activity },
  { key: "mailboxes", href: "/mailboxes", label: "nav_mailboxes", icon: Inbox },
  { key: "settings", href: "/settings", label: "nav_settings", icon: Settings },
  { key: "rules", href: "/rules", label: "nav_rules", icon: ListFilter },
];

// Shown after "activity" while the organization has the feature `stats_page` on (`/api/me` field `features`).
export const STATS_ITEM: NavItem = { key: "stats", href: "/stats", label: "nav_stats", icon: BarChart3 };

export function navItems(features: readonly string[]): NavItem[] {
  if (!features.includes("stats_page")) return TAB_ITEMS;
  const [first, ...rest] = TAB_ITEMS;
  return first === undefined ? [STATS_ITEM] : [first, STATS_ITEM, ...rest];
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
