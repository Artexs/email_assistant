import { EVIDENCE_MIN_LABELS, M2_KINDS, type CliDescription, type WeekStats, UsageError } from "@ea/core";
import { z } from "zod";

import { parseFlags } from "./lib/parse-flags";

export const statsWeekUsage = "bun run stats:week --org-id <uuid> [--mailbox-id <uuid>] [--week YYYY-MM-DD]";

export const cliDescriptions = [
  {
    name: "stats:week",
    summary: "Prints the metrics of one finished week of an organization, one key value line each.",
    risk: "read",
    needs: ["db"],
    usage: statsWeekUsage,
    exits: {
      1: "the organization or the mailbox is unknown, or the run failed",
      3: "the database did not answer",
    },
  },
] satisfies readonly CliDescription[];

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

const optionsSchema = z.object({
  orgId: z.uuid(),
  mailboxId: z.uuid().optional(),
  week: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isMonday)
    .optional(),
});

// Throws `UsageError` on any bad argument.
export function parseStatsWeekArgs(args: string[]): StatsWeekOptions {
  const { values } = parseFlags({
    args,
    options: { "org-id": { type: "string" }, "mailbox-id": { type: "string" }, week: { type: "string" } },
  });
  const parsed = optionsSchema.safeParse({
    orgId: values["org-id"],
    mailboxId: values["mailbox-id"],
    week: values.week,
  });
  if (!parsed.success) {
    throw new UsageError("--org-id is required; --org-id and --mailbox-id must be uuids; --week must be a Monday");
  }
  return { orgId: parsed.data.orgId, mailboxId: parsed.data.mailboxId ?? null, week: parsed.data.week ?? null };
}

// Every rate has its count; a denominator of 0 prints "-".
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
    ...M2_KINDS.flatMap((kind) => {
      const tally = m2.byKind?.[kind];
      return tally === undefined
        ? []
        : [
            `m2_${kind} due ${tally.due} closed ${tally.closedOnTime} surfaced ${tally.surfacedOnTime} pending ${tally.pending}`,
          ];
    }),
    `m3_total ${m3.total} hidden ${m3.hiddenImportant} wrong_person ${m3.wrongPerson} wrong_content ${m3.wrongContent}` +
      ` sent_mistake ${m3.sentMistake} not_needed ${m3.notNeeded} no_reason ${m3.noReason}`,
    `m4_handled ${share(m4.handled, m4.triaged)} would_handle ${m4.wouldHandle}`,
    `m5_urgent ${m5.urgent} noticed ${share(m5.noticed, m5.urgent)} without_notice ${m5.withoutNotice}` +
      ` quiet_hours ${m5.quietHours} p90_minutes ${num(m5.p90Minutes, 0)}`,
    `m7_cost per_mailbox_month_usd ${num(m7.perMailboxMonthUsd)} target_usd ${num(m7.targetUsd)}` +
      ` llm_usd_week ${num(m7.llmUsdWeek, 4)} llm_calls ${m7.llmCalls} unpriced_calls ${m7.unpricedCalls}` +
      ` mailboxes ${m7.mailboxes} hosting_usd_month ${num(m7.hostingUsdMonth)} backup_usd_month ${num(m7.backupUsdMonth)}`,
  ];
  // The draft outcomes of the reply drafts: one line while any count is above 0, so a week with the feature off prints none.
  const { replyDrafts } = stats;
  if (Object.values(replyDrafts).some((count) => count > 0)) {
    lines.push(
      `reply_drafts made ${replyDrafts.made} sent_by_tap ${replyDrafts.sent_by_tap} sent_by_user ${replyDrafts.sent_by_user}` +
        ` rejected ${replyDrafts.rejected} expired ${replyDrafts.expired} newer_mail ${replyDrafts.newer_mail}` +
        ` answered ${replyDrafts.answered} original_moved ${replyDrafts.original_moved}` +
        ` draft_changed ${replyDrafts.draft_changed} no_draft ${replyDrafts.no_draft} failed ${replyDrafts.failed}`
    );
  }
  for (const row of stats.m8) {
    const shown = row.kept >= EVIDENCE_MIN_LABELS;
    lines.push(
      `m8 ${row.mailboxId} ${row.category} auto ${row.auto ? "yes" : "no"} kept ${row.kept}` +
        ` precision ${shown ? num(row.precision) : "-"} lower ${shown ? num(row.wilsonLower) : "-"} ${row.decision}`
    );
    // The three sources of ADR 0028; no line with the flag `trust_ladder` off.
    if (row.global !== null) {
      const history =
        row.history === null ? "none" : `${row.history.outcome} (${row.history.moved}/${row.history.acted})`;
      const trip = row.trip?.tripped === true ? (row.trip.reason ?? "tripped") : "none";
      lines.push(
        `m8_trust ${row.mailboxId} ${row.category} global ${row.global.decision}${row.global.provisional ? " provisional" : ""} · history ${history} · trip ${trip}`
      );
    }
  }
  return lines;
}
