// The Monday message and the rate text of the handled-share line (F100 stage 16, D23, D24). Pure: facts in, text out.
import { weekRange } from "../metrics/week";
import type { CoreTexts } from "../texts";
import { barCategories } from "../triage/metrics";
import { LOOP_KINDS, type WeekStats } from "../web/stats";

import { formatDay } from "./local-time";
import type { OutMessage } from "./message";

// PD-066: a precision of real labels is shown from this many labels.
const AUTO_MIN_LABELS = 30;

/** "62% (124 of 200)"; with no mail at all "– (0 of 0)". `of` is the word between the two numbers. */
export function rateText(n: number, d: number, of = "of"): string {
  const { percent, counts } = ratePieces(n, d, of);
  return `${percent} ${counts}`;
}

// The two parts of a rate text, for a line that puts a word between them ("50% closed (1 of 2)").
function ratePieces(n: number, d: number, of: string): { percent: string; counts: string } {
  return {
    percent: d === 0 ? "–" : `${Math.round((100 * n) / d)}%`,
    counts: `(${n} ${of} ${d})`,
  };
}

function percent(value: number): number {
  return Math.round(value * 100);
}

// One item for each bar category with an auto row. With several mailboxes the row with the most kept labels stands
// for the category.
function autoItems(week: WeekStats, texts: CoreTexts): string[] {
  const t = texts.notices.weekly;
  const items: string[] = [];
  for (const category of barCategories) {
    const rows = week.m8.filter((row) => row.category === category && row.auto);
    const row = rows.reduce<(typeof rows)[number] | undefined>(
      (best, next) => (best === undefined || next.kept > best.kept ? next : best),
      undefined
    );
    if (row === undefined) continue;
    const name = t.category[category];
    if (row.kept < AUTO_MIN_LABELS || row.precision === null) {
      items.push(t.autoFew(name, row.kept, AUTO_MIN_LABELS));
    } else {
      const lower = row.wilsonLower === null ? "" : ` ${t.autoLower(percent(row.wilsonLower))}`;
      items.push(`${t.autoEnough(name, percent(row.precision), row.kept)}${lower}`);
    }
  }
  return items;
}

// F110 stage 12 (PD-066, D15): one line per bar category with the evidence of its `auto`. A category with an active trip in any
// mailbox reads "paused (reason)"; else a category with `auto` on reads proof and check, from the row with the most kept labels.
// One line per category, so the lines never grow with the number of mailboxes. A row with null keys (flag off, no reader) adds nothing.
function evidenceItems(week: WeekStats, texts: CoreTexts): string[] {
  const t = texts.notices.weekly;
  const items: string[] = [];
  for (const category of barCategories) {
    const rows = week.m8.filter((row) => row.category === category);
    const name = t.category[category];
    const paused = rows.find((row) => row.trip?.tripped === true && row.trip.reason !== null);
    if (paused?.trip?.reason) {
      items.push(t.autoPaused(name, t.pauseReason[paused.trip.reason]));
      continue;
    }
    const on = rows
      .filter((row) => row.auto)
      .reduce<
        (typeof rows)[number] | undefined
      >((best, next) => (best === undefined || next.kept > best.kept ? next : best), undefined);
    if (on?.global === undefined || on.global === null) continue;
    const proof =
      on.global.decision === "go" ? t.proof.go : on.global.decision === "none" ? t.proof.none : t.proof.noGo;
    const outcome = on.history?.outcome;
    const check =
      outcome === undefined
        ? t.check.none
        : outcome === "pass"
          ? t.check.pass
          : outcome === "fail"
            ? t.check.fail
            : outcome === "inconclusive"
              ? t.check.inconclusive
              : t.check.noResult;
    items.push(t.autoOn(name, proof, check));
  }
  return items;
}

export function renderWeeklyReport(
  view: { week: WeekStats; timeZone: string; answeredWaiting: number },
  texts: CoreTexts
): OutMessage {
  const { week, timeZone } = view;
  const t = texts.notices.weekly;
  const of = texts.common.of;
  const { m1, m2, m3, m4, m5, m7 } = week;
  const range = weekRange(week.weekStart, timeZone);
  const lines = [
    t.title(
      formatDay(range.start, timeZone, texts.locale),
      formatDay(new Date(range.end.getTime() - 1), timeZone, texts.locale)
    ),
  ];

  if (m1.important === 0 && m4.triaged === 0) lines.push(t.noMail);
  else {
    lines.push(t.missed(rateText(m1.misses, m1.important, of)));
    if (m1.sample.labelled > 0) lines.push(t.sample(m1.sample.misses, m1.sample.important));
  }

  if (m2.due === 0) lines.push(t.loopsNone(m2.pending));
  else {
    const closed = ratePieces(m2.closedOnTime, m2.due, of);
    const surfaced = ratePieces(m2.surfacedOnTime, m2.due, of);
    lines.push(
      t.loops(
        t.loopsClosed(closed.percent, closed.counts),
        t.loopsSurfaced(surfaced.percent, surfaced.counts),
        m2.pending
      )
    );
  }

  // The split by kind is there only with the flag `open_loops` on; without it the sums are 0 and no line shows.
  const loops = { due: 0, closedOnTime: 0, surfacedOnTime: 0 };
  for (const kind of LOOP_KINDS) {
    const tally = m2.byKind?.[kind];
    loops.due += tally?.due ?? 0;
    loops.closedOnTime += tally?.closedOnTime ?? 0;
    loops.surfacedOnTime += tally?.surfacedOnTime ?? 0;
  }
  if (loops.due > 0) {
    const closed = ratePieces(loops.closedOnTime, loops.due, of);
    const surfaced = ratePieces(loops.surfacedOnTime, loops.due, of);
    lines.push(
      t.loopsOf(t.loopsClosed(closed.percent, closed.counts), t.loopsSurfaced(surfaced.percent, surfaced.counts))
    );
  }

  const { mistakes } = t;
  lines.push(
    `${mistakes.total(m3.total)} (${[
      mistakes.hiddenImportant(m3.hiddenImportant),
      mistakes.wrongPerson(m3.wrongPerson),
      mistakes.wrongContent(m3.wrongContent),
      mistakes.sentByMistake(m3.sentMistake),
    ].join(", ")})`
  );

  lines.push(t.handled(rateText(m4.handled, m4.triaged, of)));
  if (m4.handled === 0 && m4.wouldHandle > 0) lines.push(t.wouldHandle(rateText(m4.wouldHandle, m4.triaged, of)));

  lines.push(m5.urgent === 0 ? t.urgentNone : t.urgent(m5.p90Minutes, m5.noticed, m5.withoutNotice));
  lines.push(t.cost(m7.perMailboxMonthUsd.toFixed(2), m7.targetUsd, m7.unpricedCalls));

  const items = autoItems(week, texts);
  lines.push(items.length === 0 ? t.autoNone : t.auto(items.join("; ")));
  lines.push(...evidenceItems(week, texts));

  if (view.answeredWaiting > 0) lines.push(t.review(view.answeredWaiting));
  return { text: lines.join("\n"), buttons: [] };
}
