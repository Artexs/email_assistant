import { Activity, ClipboardList, Inbox, ListFilter, Settings, ShieldCheck, type LucideIcon } from "lucide-react";

import type { TextKey } from "../../i18n";

export type NavKey = "onboarding" | "activity" | "mailboxes" | "settings" | "rules" | "operator";

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
