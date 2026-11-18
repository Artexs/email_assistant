import { DAY_MS } from "../time";

// The tripwire rule (F110 D9): when user corrections pause an `auto` category.
export const tripReasons = [
  "corrections",
  "important_hidden",
  "model_switch",
  "evidence_changed",
  "history_fail",
] as const;
export type TripReason = (typeof tripReasons)[number];

export interface TripState {
  tripped: boolean;
  reason: TripReason | null;
  at: Date | null;
}

export const TRIP_WINDOW_DAYS = 7;
export const TRIP_MIN_CORRECTIONS = 2;

/** `corrections` holds only the corrections that count under D9. The window is the 7 days before `now`. */
export function tripwireDue(input: {
  corrections: readonly { at: Date; important: boolean }[];
  now: Date;
}): "corrections" | "important_hidden" | null {
  const from = input.now.getTime() - TRIP_WINDOW_DAYS * DAY_MS;
  const inWindow = input.corrections.filter((c) => c.at.getTime() >= from && c.at.getTime() <= input.now.getTime());
  if (inWindow.some((c) => c.important)) return "important_hidden";
  if (inWindow.length >= TRIP_MIN_CORRECTIONS) return "corrections";
  return null;
}
