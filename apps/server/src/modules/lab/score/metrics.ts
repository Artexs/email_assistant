import type { Category, UrgentNoticeRow } from "@ea/core";

import type { Db, TenantContext } from "../../../platform/db";
import { listUrgentNoticeTimes } from "../../channels";
import { rangeMetrics, type RangeMetrics } from "../../reports";

import type { ScoredMail } from "./join";
import { pct, section, table } from "./render-util";
import type { SectionScope } from "./section";

export interface CostSection {
  // The cost of the `llm.call` rows of the run days (week run) or of the whole window (day run).
  usd: number;
  calls: number;
  unpricedCalls: number;
  // Cost per mail that reached the server (a joined mail); null when no mail did.
  usdPerMail: number | null;
  // Week run only: the 7-day figure scaled to a month by the core cost metric. A day run has none: "needs a week run".
  perMailboxMonthUsd: number | null;
  targetUsd: number;
  // Week run only: the cost of the calls after the last run day (the tail), apart from the figure above.
  tail: { usd: number; calls: number; unpricedCalls: number } | null;
}

export interface MetricsSection {
  mode: "day" | "week";
  window: { start: string; end: string };
  m2: RangeMetrics["m2"];
  m3: RangeMetrics["m3"];
  m4: RangeMetrics["m4"];
  m5: RangeMetrics["m5"];
  // Urgent slots whose injection was late: their latency starts at the stored received time, so a late injection does
  // not count against the system. Slot ids.
  m5Late: string[];
  m7: CostSection;
}

export function costSection(
  mode: "day" | "week",
  metrics: Pick<RangeMetrics, "m7" | "tailLlm">,
  mails: number
): CostSection {
  const { m7 } = metrics;
  return {
    usd: m7.llmUsdWeek,
    calls: m7.llmCalls,
    unpricedCalls: m7.unpricedCalls,
    usdPerMail: mails === 0 ? null : m7.llmUsdWeek / mails,
    perMailboxMonthUsd: mode === "week" ? m7.perMailboxMonthUsd : null,
    targetUsd: m7.targetUsd,
    tail: mode === "week" ? metrics.tailLlm : null,
  };
}

/** The end of the last run day: where the M7 window of a week run stops and the tail begins. */
const runDaysEnd = (scope: SectionScope): Date => new Date(scope.run.plan.endsAt);

/**
 * M2 to M5 and M7 for the run window, from `rangeMetrics` (the one join point of the metric readers). The window is the
 * plan start 00:00 Warsaw to the tail end, the run mailbox, no test senders: lab mail is real in its own stack. The truth of
 * a hidden move comes from the slot. Returns the M5 rows too, for the phishing section.
 */
export async function scoreMetricsSection(
  db: Db,
  ctx: TenantContext,
  scope: SectionScope,
  joined: readonly ScoredMail[]
): Promise<{ section: MetricsSection; urgent: UrgentNoticeRow[] }> {
  const mode = scope.run.plan.mode;
  const truth = new Map<string, Category>(
    joined.flatMap((row) => (row.emailId === null ? [] : [[row.emailId, row.truth]]))
  );
  const result = await rangeMetrics(
    db,
    ctx,
    {
      range: scope.window,
      mailboxId: scope.mailboxId,
      now: scope.now,
      ...(mode === "week" ? { llmRange: { start: scope.window.start, end: runDaysEnd(scope) } } : {}),
      truth,
    },
    { urgentNotices: listUrgentNoticeTimes, testMail: { senders: [] } }
  );
  if (result === "not_found") throw new Error("lab score: the run mailbox is not in the run organization");
  return {
    urgent: result.urgent,
    section: {
      mode,
      window: { start: scope.window.start.toISOString(), end: scope.window.end.toISOString() },
      m2: result.m2,
      m3: result.m3,
      m4: result.m4,
      m5: result.m5,
      m5Late: joined.filter((row) => row.truth === "urgent" && (row.lateBySec ?? 0) > 0).map((row) => row.slotId),
      m7: costSection(mode, result, joined.filter((row) => row.emailId !== null).length),
    },
  };
}

const usd = (value: number): string => `$${value.toFixed(4)}`;

export const renderMetrics = section<MetricsSection>((data) => {
  const { m2, m3, m4, m5, m7 } = data;
  const share = (part: number, whole: number): string => (whole === 0 ? "n/a" : pct(part / whole));
  return [
    "## Metrics M2 to M5, M7",
    "",
    `Window ${data.window.start} to ${data.window.end} (plan start 00:00 Warsaw to the end of the tail), run mailbox, no test senders.`,
    "",
    "### M2: open loops on time",
    "",
    `Delegations due in the window ${m2.due}: closed on time ${m2.closedOnTime} (${share(m2.closedOnTime, m2.due)}), surfaced on time ${m2.surfacedOnTime} (${share(m2.surfacedOnTime, m2.due)}), not decided yet ${m2.pending}.`,
    "",
    "### M3: serious mistakes",
    "",
    ...table(
      [
        "Hidden important",
        "Wrong person",
        "Wrong content",
        "Sent mistake",
        "Total",
        "Not needed (shown)",
        "No reason (shown)",
      ],
      [
        [m3.hiddenImportant, m3.wrongPerson, m3.wrongContent, m3.sentMistake, m3.total, m3.notNeeded, m3.noReason].map(
          String
        ),
      ]
    ),
    "",
    "### M4: handled share",
    "",
    `Triaged ${m4.triaged}, handled ${m4.handled} (${share(m4.handled, m4.triaged)}), would handle in shadow ${m4.wouldHandle}.`,
    "",
    "### M5: urgent notice latency",
    "",
    `Urgent mails outside quiet hours ${m5.urgent}: noticed ${m5.noticed}, without notice ${m5.withoutNotice}; quiet hours ${m5.quietHours}; p90 ${m5.p90Minutes === null ? "n/a" : `${m5.p90Minutes} min`}. Latency starts at the stored received time.`,
    `Late injections of urgent mail (${data.m5Late.length}): ${data.m5Late.length === 0 ? "none" : data.m5Late.join(", ")}.`,
    "",
    "### M7: cost",
    "",
    `LLM cost ${usd(m7.usd)} in ${m7.calls} calls (${m7.unpricedCalls} unpriced), per mail ${m7.usdPerMail === null ? "n/a" : usd(m7.usdPerMail)}.`,
    data.mode === "week"
      ? `Month figure per mailbox (7 run days scaled by the core cost metric): ${m7.perMailboxMonthUsd === null ? "n/a" : usd(m7.perMailboxMonthUsd)}; target ${usd(m7.targetUsd)}.`
      : "Month figure per mailbox: needs a week run.",
    ...(m7.tail === null
      ? []
      : [
          `Tail cost (after the run days, not in the month figure): ${usd(m7.tail.usd)} in ${m7.tail.calls} calls (${m7.tail.unpricedCalls} unpriced).`,
        ]),
    "",
  ];
});
