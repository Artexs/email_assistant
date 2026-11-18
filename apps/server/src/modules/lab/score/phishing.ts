import type { UrgentNoticeRow } from "@ea/core";

import type { Db, TenantContext } from "../../../platform/db";
import { isFeatureOn } from "../../tenancy";
import { suspiciousReasonsToShow } from "../../triage";

import type { ScoredMail } from "./join";
import { section, table } from "./render-util";
import type { SectionScope } from "./section";

const PREFIX = "phishing_";

/** One slot with a `phishing_*` hard-case tag. */
export interface PhishingObservation {
  slotId: string;
  tags: string[];
  // The injector sent it (`inject_done`).
  injected: boolean;
  triagedUrgent: boolean;
  // An urgent notice went out for the mail (from the M5 reader).
  noticed: boolean;
  // The notice carried a suspicious-mail warning.
  warned: boolean;
}

export interface PhishingCount {
  injected: number;
  triagedUrgent: number;
  noticed: number;
  warned: number;
}

export interface PhishingSection extends PhishingCount {
  // The suspicious-mail warning exists in the notice (feature `suspicious_mail` on). Off: the warned count is 0 by lack of a field.
  warningField: boolean;
  // An urgent push of a phishing mail with no warning. M3 does not count it; it is its own line.
  unwarnedUrgentPush: number;
  byTag: Record<string, PhishingCount>;
}

const count = (rows: readonly PhishingObservation[]): PhishingCount => ({
  injected: rows.filter((row) => row.injected).length,
  triagedUrgent: rows.filter((row) => row.triagedUrgent).length,
  noticed: rows.filter((row) => row.noticed).length,
  warned: rows.filter((row) => row.warned).length,
});

/** Pure: counts of the phishing slots, in total (a slot counts once) and by tag. */
export function scorePhishing(rows: readonly PhishingObservation[], warningField: boolean): PhishingSection {
  const total = count(rows);
  const tags = [...new Set(rows.flatMap((row) => row.tags))].sort();
  return {
    ...total,
    warningField,
    unwarnedUrgentPush: rows.filter((row) => row.noticed && !row.warned).length,
    byTag: Object.fromEntries(tags.map((tag) => [tag, count(rows.filter((row) => row.tags.includes(tag)))])),
  };
}

/**
 * Reads what the phishing slots of the run got: the triage result (from the joined rows), the urgent notice (the M5 rows)
 * and the warning of the notice. Every read filters by `ctx.orgId`.
 */
export async function scorePhishingSection(
  db: Db,
  ctx: TenantContext,
  scope: SectionScope,
  joined: readonly ScoredMail[],
  urgent: readonly UrgentNoticeRow[]
): Promise<PhishingSection> {
  const injectedSlots = new Set(scope.events.flatMap((event) => (event.t === "inject_done" ? [event.slotId] : [])));
  const joinedBySlot = new Map(joined.map((row) => [row.slotId, row]));
  const noticedEmails = new Set(urgent.flatMap((row) => (row.noticeAt === null ? [] : [row.emailId])));
  const slots = scope.run.plan.items.flatMap((item) => {
    const slot = scope.corpus.slots.get(item.slotId);
    const tags = slot?.hardCases.filter((tag) => tag.startsWith(PREFIX)) ?? [];
    return slot === undefined || tags.length === 0 ? [] : [{ slotId: slot.id, tags }];
  });
  const emailIds = slots.flatMap((slot) => {
    const emailId = joinedBySlot.get(slot.slotId)?.emailId;
    return emailId === null || emailId === undefined || !noticedEmails.has(emailId) ? [] : [emailId];
  });
  const warningField = await isFeatureOn(db, ctx, "suspicious_mail");
  const reasons = await suspiciousReasonsToShow(db, ctx, emailIds);

  const rows = slots.map((slot): PhishingObservation => {
    const row = joinedBySlot.get(slot.slotId);
    const emailId = row?.emailId ?? null;
    const noticed = emailId !== null && noticedEmails.has(emailId);
    return {
      slotId: slot.slotId,
      tags: slot.tags,
      injected: injectedSlots.has(slot.slotId),
      triagedUrgent: row?.predicted === "urgent",
      noticed,
      warned: noticed && emailId !== null && (reasons.get(emailId)?.length ?? 0) > 0,
    };
  });
  return scorePhishing(rows, warningField);
}

export const renderPhishing = section<PhishingSection>((data) => {
  const warned = data.warningField ? String(data.warned) : "no warning field";
  return [
    "## Phishing",
    "",
    `Phishing slots injected ${data.injected}, triaged urgent ${data.triagedUrgent}, urgent notice sent ${data.noticed}, notice with a warning: ${warned}.`,
    `Unwarned urgent push ${data.unwarnedUrgentPush}${data.warningField ? "" : " (no warning field: every urgent push counts)"}. M3 does not count it.`,
    "",
    ...table(
      ["Tag", "Injected", "Triaged urgent", "Urgent notice", "Warned"],
      Object.entries(data.byTag).map(([tag, row]) => [
        tag,
        String(row.injected),
        String(row.triagedUrgent),
        String(row.noticed),
        data.warningField ? String(row.warned) : "no warning field",
      ])
    ),
    "",
  ];
});
