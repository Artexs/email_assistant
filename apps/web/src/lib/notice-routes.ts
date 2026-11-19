import type { NotifyView } from "@ea/core/web";

import { t, type TextKey } from "../i18n";

// The notice routes card: which channel gets each group of notices. The model is a set of pure functions: the card renders what they
// return and sends what `routesPatchOf` returns. The server holds the rule (`effectiveRoute`); this file only shows it.

export const routeGroups = ["urgent", "approvals", "updates"] as const;
export type RouteGroup = (typeof routeGroups)[number];
export const routeValues = ["telegram", "push", "both"] as const;
export type RouteValue = (typeof routeValues)[number];
// What the user changed, per group. A group that is not here was not touched.
export type RouteDraft = Partial<Record<RouteGroup, RouteValue>>;

type RouteView = Pick<NotifyView, "routes" | "routeDefaults">;

export const groupLabels: Record<RouteGroup, TextKey> = {
  urgent: "nr_group_urgent",
  approvals: "nr_group_approvals",
  updates: "nr_group_updates",
};
const valueLabels: Record<RouteValue, TextKey> = { telegram: "nr_telegram", push: "nr_phone", both: "nr_both" };

/** The value that a group follows with no stored choice, from the channels that exist now (`routeDefaults`). */
export function defaultRouteOf(view: RouteView, group: RouteGroup): RouteValue {
  const { telegram, push } = view.routeDefaults[group];
  if (telegram && push) return "both";
  return push ? "push" : "telegram";
}

/** The value that the select shows with no change by the user: the stored choice, else the default. */
export function currentRouteOf(view: RouteView, group: RouteGroup): RouteValue {
  return view.routes[group] ?? defaultRouteOf(view, group);
}

export interface RouteOption {
  value: RouteValue;
  label: string;
}

/** The three options of one select. The option that is the default of the group carries the "(default)" mark. */
export function routeOptionsOf(view: RouteView, group: RouteGroup): RouteOption[] {
  const fallback = defaultRouteOf(view, group);
  return routeValues.map((value) => ({
    value,
    label: value === fallback ? t("nr_default", { value: t(valueLabels[value]) }) : t(valueLabels[value]),
  }));
}

/**
 * The body of `PATCH /api/me/notify` for a draft: only a group that the user touched and that now differs from what the select showed.
 * An untouched select sends nothing, so it keeps following the default. null: nothing to send.
 */
export function routesPatchOf(view: RouteView, draft: RouteDraft): Partial<Record<RouteGroup, RouteValue>> | null {
  const patch: Partial<Record<RouteGroup, RouteValue>> = {};
  for (const group of routeGroups) {
    const chosen = draft[group];
    if (chosen !== undefined && chosen !== currentRouteOf(view, group)) patch[group] = chosen;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

/** The body that removes every stored choice (back to the defaults). null: no choice is stored. */
export function routesResetOf(view: RouteView): Partial<Record<RouteGroup, null>> | null {
  const reset: Partial<Record<RouteGroup, null>> = {};
  for (const group of routeGroups) if (view.routes[group] !== undefined) reset[group] = null;
  return Object.keys(reset).length === 0 ? null : reset;
}

/** True when no notice can reach the member: no Telegram chat and no live device (the defaults hold no channel at all). */
export function hasNoChannel(view: RouteView & Pick<NotifyView, "telegramLinked">): boolean {
  return !view.telegramLinked && routeGroups.every((group) => !view.routeDefaults[group].push);
}
