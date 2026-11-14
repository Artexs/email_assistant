import { barCategories, EVIDENCE_MIN_LABELS, type BarCategory, type WeekStats } from "@ea/core/web";

import { dateLocale, t, type TextKey } from "../i18n";

export interface StatsCell {
  text: string;
}

export interface StatsRow {
  label: TextKey;
  cells: StatsCell[];
}

const NONE = "–";

function percent(count: number, total: number): number {
  return Math.round((count / total) * 100);
}

// A rate always shows its count; a denominator of 0 shows a dash, never "0%".
function rateText(count: number, total: number): string {
  if (total === 0) return NONE;
  return t("stats_rate", { percent: percent(count, total), count, total });
}

function minutesText(week: WeekStats): string {
  const { p90Minutes, noticed } = week.m5;
  if (p90Minutes === null) return NONE;
  return t("stats_minutes", { minutes: Number(p90Minutes.toFixed(1)), noticed });
}

// M8 is the evidence of one category. With several mailboxes the row with the most kept mails speaks for it.
function evidenceText(week: WeekStats, category: BarCategory): string {
  let best: WeekStats["m8"][number] | null = null;
  for (const row of week.m8) {
    if (row.category !== category || row.precision === null || row.wilsonLower === null) continue;
    if (best === null || row.kept > best.kept) best = row;
  }
  if (best === null || best.precision === null || best.wilsonLower === null) return NONE;
  // Below the label minimum a precision says too little: show the count of labels only (PD-066).
  if (best.kept < EVIDENCE_MIN_LABELS) return t("stats_evidence_few", { kept: best.kept, min: EVIDENCE_MIN_LABELS });
  return t(best.auto ? "stats_evidence_auto" : "stats_evidence", {
    percent: Math.round(best.precision * 100),
    kept: best.kept,
    lower: Math.round(best.wilsonLower * 100),
  });
}

function sampleText(week: WeekStats): string {
  const { labelled, misses, important } = week.m1.sample;
  if (labelled === 0) return NONE;
  return t("stats_of", { count: misses, total: important });
}

// One row per metric, one cell per week, in the order of `weeks` (the API sends the newest first).
export function statsRows(weeks: readonly WeekStats[]): StatsRow[] {
  const row = (label: TextKey, cell: (week: WeekStats) => string): StatsRow => ({
    label,
    cells: weeks.map((week) => ({ text: cell(week) })),
  });
  return [
    row("stats_m1", (w) => rateText(w.m1.misses, w.m1.important)),
    row("stats_m1_sample", sampleText),
    row("stats_m2_closed", (w) => rateText(w.m2.closedOnTime, w.m2.due)),
    row("stats_m2_surfaced", (w) => rateText(w.m2.surfacedOnTime, w.m2.due)),
    row("stats_m3", (w) => String(w.m3.total)),
    row("stats_m4", (w) => rateText(w.m4.handled, w.m4.triaged)),
    row("stats_m4_would", (w) => rateText(w.m4.wouldHandle, w.m4.triaged)),
    row("stats_m5", minutesText),
    row("stats_m7", (w) => `$${w.m7.perMailboxMonthUsd.toFixed(2)}`),
    ...barCategories.map((category) => row(`stats_m8_${category}`, (w) => evidenceText(w, category))),
  ];
}

// The Monday of a week as "16 Nov" (the date has no time zone: it is a calendar day).
export function weekLabel(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  return date.toLocaleDateString(dateLocale(), { day: "numeric", month: "short", timeZone: "UTC" });
}
