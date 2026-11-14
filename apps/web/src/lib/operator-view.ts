import type { OperatorOrgRow } from "@ea/core/web";

import { dateLocale, t } from "../i18n";

// The first 8 characters of an id; the full id goes in a `title`.
export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function costText(costUsd: number): string {
  return `$${costUsd.toFixed(4)}`;
}

export function llmTodayText(llm: OperatorOrgRow["llmToday"]): string {
  const line = t("op_llm_today", { calls: llm.calls, cost: costText(llm.costUsd) });
  return llm.unpricedCalls > 0 ? `${line} ${t("op_llm_unpriced", { count: llm.unpricedCalls })}` : line;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// A past time as "5 min ago". A time in the future (clock skew) reads as "just now".
export function ageText(at: string | null, now: Date): string {
  if (at === null) return t("op_never");
  const ms = now.getTime() - new Date(at).getTime();
  if (ms < MINUTE) return t("op_just_now");
  if (ms < HOUR) return t("op_minutes_ago", { count: Math.floor(ms / MINUTE) });
  if (ms < 48 * HOUR) return t("op_hours_ago", { count: Math.floor(ms / HOUR) });
  return t("op_days_ago", { count: Math.floor(ms / (24 * HOUR)) });
}

// A day in UTC, so the operator reads the same date as the server rows. No value reads as "none".
export function dayText(at: string | null): string {
  if (at === null) return t("op_none");
  return new Intl.DateTimeFormat(dateLocale(), { timeZone: "UTC", dateStyle: "medium" }).format(new Date(at));
}

// Newest first; the same time orders by organization id.
export function sortNotices<T extends { at: string; orgId: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const byTime = new Date(b.at).getTime() - new Date(a.at).getTime();
    if (byTime !== 0) return byTime;
    return a.orgId < b.orgId ? -1 : a.orgId > b.orgId ? 1 : 0;
  });
}
