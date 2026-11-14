// M5: urgent notice time. Minutes from the arrival of an urgent mail to its notice; quiet hours are left out.
import { isQuietTime } from "../digest/local-time";

export interface UrgentNoticeRow {
  emailId: string;
  receivedAt: Date;
  noticeAt: Date | null; // the earliest sent_at of its urgent outbox rows
}

export interface UrgentLatency {
  urgent: number; // rows outside quiet hours
  noticed: number;
  withoutNotice: number;
  quietHours: number; // rows that arrived in quiet hours (left out of the rest)
  p90Minutes: number | null; // nearest rank, one decimal
}

const MINUTE_MS = 60_000;

export function urgentLatency(rows: readonly UrgentNoticeRow[], opts: { timeZone: string }): UrgentLatency {
  const minutes: number[] = [];
  let urgent = 0;
  let withoutNotice = 0;
  let quietHours = 0;
  for (const row of rows) {
    if (isQuietTime(row.receivedAt, opts.timeZone)) {
      quietHours += 1;
      continue;
    }
    urgent += 1;
    if (row.noticeAt === null) {
      withoutNotice += 1;
      continue;
    }
    minutes.push(Math.max(0, row.noticeAt.getTime() - row.receivedAt.getTime()) / MINUTE_MS);
  }
  minutes.sort((a, b) => a - b);
  const p90 = minutes.length === 0 ? null : minutes[Math.ceil(0.9 * minutes.length) - 1];
  return {
    urgent,
    noticed: minutes.length,
    withoutNotice,
    quietHours,
    p90Minutes: p90 === null ? null : Math.round(p90 * 10) / 10,
  };
}
