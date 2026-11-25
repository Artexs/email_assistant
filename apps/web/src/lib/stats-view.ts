import {
  barCategories,
  EVIDENCE_MIN_LABELS,
  M2_KINDS,
  type BarCategory,
  type M2Kind,
  type WeekStats,
} from "@ea/core/web";

import { dateLocale, t, type TextKey } from "../i18n";

import { formatTrimmed, formatUsd, percentOf, wholePercent } from "./format-number";

export interface StatsCell {
  text: string;
}

export interface StatsRow {
  label: TextKey;
  cells: StatsCell[];
}

const NONE = "–";

// A rate always shows its count; a denominator of 0 shows a dash, never "0%".
function rateText(count: number, total: number): string {
  if (total === 0) return NONE;
  return t("stats_rate", { percent: percentOf(count, total), count, total });
}

function minutesText(week: WeekStats): string {
  const { p90Minutes, noticed } = week.m5;
  if (p90Minutes === null) return NONE;
  return t("stats_minutes", { minutes: formatTrimmed(p90Minutes, 1), noticed });
}

// M8 is the evidence of one category. With several mailboxes the row with the most kept mails speaks for it.
function evidenceText(week: WeekStats, category: BarCategory): string {
  let best: WeekStats["m8"][number] | null = null;
  for (const row of week.m8) {
    if (row.category !== category || row.precision === null || row.wilsonLower === null) continue;
    if (best === null || row.kept > best.kept) best = row;
  }
  if (best === null || best.precision === null || best.wilsonLower === null) return NONE;
  // Below the label minimum a precision says too little: show the count of labels only.
  if (best.kept < EVIDENCE_MIN_LABELS) {
    return t(best.auto ? "stats_evidence_few_auto" : "stats_evidence_few", {
      kept: best.kept,
      min: EVIDENCE_MIN_LABELS,
    });
  }
  return t(best.auto ? "stats_evidence_auto" : "stats_evidence", {
    percent: wholePercent(best.precision),
    kept: best.kept,
    lower: wholePercent(best.wilsonLower),
  });
}

function sampleText(week: WeekStats): string {
  const { labelled, misses, important } = week.m1.sample;
  if (labelled === 0) return NONE;
  return t("stats_of", { count: misses, total: important });
}

// One row per kind under M2: the closed and the surfaced rate of the kind in one cell. No due loop: a dash.
function kindText(week: WeekStats, kind: M2Kind): string {
  const tally = week.m2.byKind?.[kind];
  if (tally === undefined || tally.due === 0) return NONE;
  return t("stats_m2_kind_cell", {
    closed: rateText(tally.closedOnTime, tally.due),
    surfaced: rateText(tally.surfacedOnTime, tally.due),
  });
}

const KIND_LABELS = {
  delegation: "stats_m2_kind_delegation",
  waiting: "stats_m2_kind_waiting",
  promised: "stats_m2_kind_promised",
  delegated: "stats_m2_kind_delegated",
} as const satisfies Record<M2Kind, TextKey>;

// The loop split is there when some week holds `m2.byKind` (an organization with the flag `open_loops` on).
export function hasSplit(weeks: readonly WeekStats[]): boolean {
  return weeks.some((week) => week.m2.byKind !== undefined);
}

export interface StatsHead {
  ring: { value: number; max: number; percent: string; label: TextKey };
  tiles: { value: string; label: TextKey }[];
}

function percentText(count: number, total: number): string {
  return total === 0 ? NONE : t("stats_percent", { percent: percentOf(count, total) });
}

// The head above the table: the handled share as a ring and three key numbers, all of one week (the newest).
// It shows counts the table shows too, through the same helpers, so the two never disagree.
export function statsHead(week: WeekStats, split: boolean): StatsHead {
  const { triaged, handled, wouldHandle } = week.m4;
  // In a shadow week the assistant handles nothing: the ring then shows the share it would have handled.
  const shadow = handled === 0 && wouldHandle > 0;
  const value = shadow ? wouldHandle : handled;
  const { p90Minutes } = week.m5;
  return {
    ring: {
      value,
      max: triaged,
      percent: percentText(value, triaged),
      label: shadow ? "stats_m4_would" : "stats_m4",
    },
    tiles: [
      { value: String(week.m3.total), label: "stats_m3" },
      {
        value: p90Minutes === null ? NONE : t("stats_minutes_short", { minutes: formatTrimmed(p90Minutes, 1) }),
        label: "stats_m5",
      },
      {
        value: percentText(week.m2.closedOnTime, week.m2.due),
        label: split ? "stats_m2_loops_closed" : "stats_m2_closed",
      },
    ],
  };
}

// One row per metric, one cell per week, in the order of `weeks` (the API sends the newest first).
export function statsRows(weeks: readonly WeekStats[]): StatsRow[] {
  const row = (label: TextKey, cell: (week: WeekStats) => string): StatsRow => ({
    label,
    cells: weeks.map((week) => ({ text: cell(week) })),
  });
  const split = hasSplit(weeks);
  return [
    row("stats_m1", (w) => rateText(w.m1.misses, w.m1.important)),
    row("stats_m1_sample", sampleText),
    // The split is there only for an organization with the flag `open_loops` on; the totals then hold the loops.
    row(split ? "stats_m2_loops_closed" : "stats_m2_closed", (w) => rateText(w.m2.closedOnTime, w.m2.due)),
    row(split ? "stats_m2_loops_surfaced" : "stats_m2_surfaced", (w) => rateText(w.m2.surfacedOnTime, w.m2.due)),
    ...(split ? M2_KINDS.map((kind) => row(KIND_LABELS[kind], (w) => kindText(w, kind))) : []),
    row("stats_m3", (w) => String(w.m3.total)),
    row("stats_m4", (w) => rateText(w.m4.handled, w.m4.triaged)),
    row("stats_m4_would", (w) => rateText(w.m4.wouldHandle, w.m4.triaged)),
    row("stats_m5", minutesText),
    row("stats_m7", (w) => formatUsd(w.m7.perMailboxMonthUsd, 2)),
    ...barCategories.map((category) => row(`stats_m8_${category}`, (w) => evidenceText(w, category))),
  ];
}

// The Monday of a week as "16 Nov" (the date has no time zone: it is a calendar day).
export function weekLabel(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  return date.toLocaleDateString(dateLocale(), { day: "numeric", month: "short", timeZone: "UTC" });
}
