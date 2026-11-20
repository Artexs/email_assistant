import { localDateTime, localToInstant, nextLocalDate } from "../../digest/local-time";
import { MINUTE_MS } from "../../time";
import type { Scenario } from "../scenario";
import type { Slot } from "../slot";

import { addDays, dayNumberOf, isoWeekday, parseDay } from "./calendar-days";

// The pure plan of a live run: which slots of the frozen week go out when. One shift by whole weeks moves the
// scenario days onto real days, and each slot keeps its Warsaw wall time.
const ZONE = "Europe/Warsaw";
const SECOND_MS = 1000;

export type LiveMode = "day" | "week";

export interface LiveRunPlan {
  runId: string;
  mode: LiveMode;
  startDate: string; // YYYY-MM-DD, Europe/Warsaw
  offsetDays: number; // a multiple of 7
  scenarioDays: number[]; // 1..7 of the scenario week
  items: { slotId: string; at: string }[]; // UTC ISO, sorted by at, then slotId
  endsAt: string; // UTC ISO
  tailEndsAt: string; // UTC ISO
  deadlines: { label: string; due: string }[]; // the profile deadlines, shifted
}

export interface LiveRunRefusal {
  refused: "not_monday" | "dst_change" | "bad_date";
}

export interface PlanLiveRunInput {
  scenario: Scenario;
  slots: Slot[];
  mode: LiveMode;
  startDate: string;
  runId: string;
}

const TAIL_DAYS: Record<LiveMode, number> = { week: 4, day: 1 };

// The UTC offset of Europe/Warsaw at a whole-minute instant, in minutes.
function warsawOffsetMinutes(at: Date): number {
  const local = localDateTime(at, ZONE);
  const asUtc = Date.UTC(
    Number(local.date.slice(0, 4)),
    Number(local.date.slice(5, 7)) - 1,
    Number(local.date.slice(8, 10)),
    Number(local.time.slice(0, 2)),
    Number(local.time.slice(3, 5))
  );
  return (asUtc - at.getTime()) / MINUTE_MS;
}

function midnight(date: string): Date {
  return localToInstant(date, "00:00", ZONE);
}

// The slot instant moved by `offsetDays`, with the same Warsaw wall time (seconds and milliseconds as they are).
function shiftInstant(receivedAt: string, offsetDays: number): Date {
  const original = new Date(receivedAt);
  const local = localDateTime(original, ZONE);
  const wall = localToInstant(addDays(local.date, offsetDays), local.time, ZONE);
  return new Date(wall.getTime() + (original.getUTCSeconds() * SECOND_MS + original.getUTCMilliseconds()));
}

export function liveRunId(mode: LiveMode, startDate: string, hex4: string): string {
  return `${mode}-${startDate.replaceAll("-", "")}-${hex4}`;
}

export function planLiveRun(input: PlanLiveRunInput): LiveRunPlan | LiveRunRefusal {
  const { scenario, slots, mode, startDate, runId } = input;
  if (!parseDay(startDate)) return { refused: "bad_date" };
  const weekday = isoWeekday(startDate);
  if (mode === "week" && weekday !== 1) return { refused: "not_monday" };

  const { weekStart } = scenario.calendar;
  const scenarioDays = mode === "week" ? [1, 2, 3, 4, 5, 6, 7] : [weekday];
  const firstScenarioDay = scenarioDays[0] as number;
  const offsetDays = dayNumberOf(startDate) - dayNumberOf(addDays(weekStart, firstScenarioDay - 1));

  const lastRunDay = addDays(startDate, scenarioDays.length - 1);
  const endsAtInstant = midnight(nextLocalDate(lastRunDay));
  const tailEndsInstant = midnight(addDays(nextLocalDate(lastRunDay), TAIL_DAYS[mode]));
  if (warsawOffsetMinutes(midnight(startDate)) !== warsawOffsetMinutes(tailEndsInstant)) {
    return { refused: "dst_change" };
  }

  const scenarioDates = new Set(scenarioDays.map((day) => addDays(weekStart, day - 1)));
  const items = slots
    .filter((slot) => scenarioDates.has(localDateTime(new Date(slot.receivedAt), ZONE).date))
    .map((slot) => ({ slotId: slot.id, at: shiftInstant(slot.receivedAt, offsetDays).toISOString() }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));

  return {
    runId,
    mode,
    startDate,
    offsetDays,
    scenarioDays,
    items,
    endsAt: endsAtInstant.toISOString(),
    tailEndsAt: tailEndsInstant.toISOString(),
    deadlines: scenario.urgency.profile.deadlines.map((deadline) => ({
      label: deadline.label,
      due: addDays(deadline.due, offsetDays),
    })),
  };
}
