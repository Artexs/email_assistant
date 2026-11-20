import { DAY_MS, HOUR_MS, MINUTE_MS } from "@ea/core/web";
import type { OperatorOrgDetail, OperatorOrgRow } from "@ea/core/web";

import { dateLocale, t, tp } from "../i18n";

import { formatUsd } from "./format-number";

// The first 8 characters of an id; the full id goes in a `title`.
export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function costText(costUsd: number): string {
  return formatUsd(costUsd, 4);
}

export function llmTodayText(llm: OperatorOrgRow["llmToday"]): string {
  const line = t("op_llm_today", { calls: llm.calls, cost: costText(llm.costUsd) });
  return llm.unpricedCalls > 0 ? `${line} ${t("op_llm_unpriced", { count: llm.unpricedCalls })}` : line;
}

// A past time as "5 min ago". A time in the future (clock skew) reads as "just now".
export function ageText(at: string | null, now: Date): string {
  if (at === null) return t("op_never");
  const ms = now.getTime() - new Date(at).getTime();
  if (ms < MINUTE_MS) return t("op_just_now");
  if (ms < HOUR_MS) return t("op_minutes_ago", { count: Math.floor(ms / MINUTE_MS) });
  if (ms < 2 * DAY_MS) return t("op_hours_ago", { count: Math.floor(ms / HOUR_MS) });
  return t("op_days_ago", { count: Math.floor(ms / DAY_MS) });
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

export interface SsoLines {
  domain: string;
  proof: string;
  required: string;
  linked: string;
  breakGlass: string;
}

// The SSO block of the organization detail. `null` means no provider: the caller shows `op_sso_none`.
// Only the fields of the strict operator schema reach the screen: a domain, three flags and a count.
export function ssoLines(sso: OperatorOrgDetail["sso"]): SsoLines | null {
  if (sso === null) return null;
  const proof =
    sso.proof === "dns" ? "op_sso_proof_dns" : sso.proof === "attested" ? "op_sso_proof_attested" : "op_sso_proof_none";
  return {
    domain: sso.domain,
    proof: t(proof),
    required: t(sso.required ? "op_sso_required_yes" : "op_sso_required_no"),
    linked: tp("op_sso_linked", sso.linkedMembers),
    breakGlass: t(sso.breakGlassReady ? "op_sso_break_glass_ready" : "op_sso_break_glass_missing"),
  };
}
