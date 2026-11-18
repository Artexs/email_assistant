import type { SloCheck } from "./kinds";

// The stored open state of one alert (`ops_alerts`). A row with `resolvedSentAt` set is history: callers never pass it.
export interface AlertState {
  openSentAt: Date | null;
  lastSentAt: Date | null;
  resolvedAt: Date | null;
  resolvedSentAt: Date | null;
}

export type AlertStep = "none" | "open" | "repeat" | "resolve" | "silent_close";

// What the job does for one kind on one tick. Send first, then write the mark: a crash repeats one notice.
export function nextAlertStep(row: AlertState | null, check: SloCheck, now: Date, repeatMs: number): AlertStep {
  if (row === null) return check.state === "firing" ? "open" : "none";
  // The resolved notice is owed: send it again, whatever the check says now.
  if (row.resolvedAt !== null) return "resolve";
  if (row.openSentAt === null) return check.state === "clear" ? "silent_close" : "open";
  if (check.state === "clear") return "resolve";
  const lastSentAt = row.lastSentAt ?? row.openSentAt;
  return now.getTime() - lastSentAt.getTime() >= repeatMs ? "repeat" : "none";
}
