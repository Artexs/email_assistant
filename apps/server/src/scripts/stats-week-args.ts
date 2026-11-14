import { parseArgs } from "node:util";

import { EVIDENCE_MIN_LABELS, type WeekStats } from "@ea/core";
import { z } from "zod";

export const usage = "usage: bun run stats:week --org-id <uuid> [--mailbox-id <uuid>] [--week YYYY-MM-DD]";

export interface StatsWeekOptions {
  orgId: string;
  mailboxId: string | null;
  /** A Monday; null = the last finished week in the organization's time zone. */
  week: string | null;
}

function isMonday(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const at = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return at.toISOString().slice(0, 10) === date && at.getUTCDay() === 1;
}

export function readStatsWeekOptions(args: string[]): StatsWeekOptions | undefined {
  try {
    const { values } = parseArgs({
      args,
      options: { "org-id": { type: "string" }, "mailbox-id": { type: "string" }, week: { type: "string" } },
      strict: true,
      allowPositionals: false,
    });
    const uuid = z.uuid();
    const orgId = values["org-id"];
    if (orgId === undefined || !uuid.safeParse(orgId).success) return undefined;
    const mailboxId = values["mailbox-id"] ?? null;
    if (mailboxId !== null && !uuid.safeParse(mailboxId).success) return undefined;
    const week = values.week ?? null;
    if (week !== null && !(/^\d{4}-\d{2}-\d{2}$/.test(week) && isMonday(week))) return undefined;
    return { orgId, mailboxId, week };
  } catch {
    return undefined;
  }
}

// D27: every rate has its count; a denominator of 0 prints "-".
const share = (part: number, whole: number): string =>
  whole === 0 ? `${part} of ${whole} (-)` : `${part} of ${whole} (${Math.round((part / whole) * 100)}%)`;
const num = (value: number | null, digits = 2): string => (value === null ? "-" : value.toFixed(digits));

/** One `key value …` line per metric. Counts and codes only: no address, subject or mail id. */
export function statsLines(stats: WeekStats): string[] {
  const { m1, m2, m3, m4, m5, m7 } = stats;
  const sources = m1.missesBySource;
  const lines = [
    `week ${stats.weekStart} mailbox ${stats.mailboxId ?? "all"}`,
    `m1_missed ${m1.misses} of ${m1.important} (lower bound) sample ${m1.sample.misses} of ${m1.sample.important}` +
      ` labelled ${m1.sample.labelled} miss_rate_upper ${num(m1.sample.missRateUpper)}`,
    `m1_sources correction ${sources.correction} review ${sources.review} moved_back ${sources.moved_back} answered_check ${sources.answered_check}`,
    `m2_open_loops due ${m2.due} closed_on_time ${share(m2.closedOnTime, m2.due - m2.pending)}` +
      ` surfaced_on_time ${share(m2.surfacedOnTime, m2.due - m2.pending)} pending ${m2.pending}`,
    `m3_total ${m3.total} hidden ${m3.hiddenImportant} wrong_person ${m3.wrongPerson} wrong_content ${m3.wrongContent}` +
      ` sent_mistake ${m3.sentMistake} not_needed ${m3.notNeeded} no_reason ${m3.noReason}`,
    `m4_handled ${share(m4.handled, m4.triaged)} would_handle ${m4.wouldHandle}`,
    `m5_urgent ${m5.urgent} noticed ${share(m5.noticed, m5.urgent)} without_notice ${m5.withoutNotice}` +
      ` quiet_hours ${m5.quietHours} p90_minutes ${num(m5.p90Minutes, 0)}`,
    `m7_cost per_mailbox_month_usd ${num(m7.perMailboxMonthUsd)} target_usd ${num(m7.targetUsd)}` +
      ` llm_usd_week ${num(m7.llmUsdWeek, 4)} llm_calls ${m7.llmCalls} unpriced_calls ${m7.unpricedCalls}` +
      ` mailboxes ${m7.mailboxes} hosting_usd_month ${num(m7.hostingUsdMonth)} backup_usd_month ${num(m7.backupUsdMonth)}`,
  ];
  for (const row of stats.m8) {
    const shown = row.kept >= EVIDENCE_MIN_LABELS;
    lines.push(
      `m8 ${row.mailboxId} ${row.category} auto ${row.auto ? "yes" : "no"} kept ${row.kept}` +
        ` precision ${shown ? num(row.precision) : "-"} lower ${shown ? num(row.wilsonLower) : "-"} ${row.decision}`
    );
  }
  return lines;
}
