import { lastFinishedWeek, localDateTime, localToInstant, parseDigestTimes } from "@ea/core";

import { weekStats } from "../../reports";
import { getMembership, isFeatureOn } from "../../tenancy";
import { countAnsweredWaiting } from "../../triage";
import { listUrgentNoticeTimes } from "../metrics-repo";
import { findOutboxByDedup } from "../repo";

import { queue, warnSkipped, type Detector, type OrgRun } from "./run";

export const WEEKLY_DEFAULT_TIME = "08:00";
export const WEEKLY_EARLIEST_TIME = "07:00";
export const WEEKLY_RETRY_MS = 15 * 60_000;
const ANSWERED_WAITING_MS = 14 * 24 * 3_600_000;

/** The member's slot: the first digest time ≥ 07:00 on that Monday, else 08:00 (local). */
export function weeklySlot(digestTimes: readonly string[]): string {
  return [...digestTimes].sort().find((time) => time >= WEEKLY_EARLIEST_TIME) ?? WEEKLY_DEFAULT_TIME;
}

// The time of the last failed attempt per organization and week. A failing run waits 15 minutes: the notifier ticks every
// 15 s, and each attempt would read the whole week again. Each run drops the keys of other weeks, so the map holds at
// most one key per organization.
const failedAt = new Map<string, number>();

/** The keys of the failed attempts on record (for tests). */
export const failedAttemptKeys = (): string[] => [...failedAt.keys()];

// On Monday, every linked member gets the numbers of the last finished week at the member's own slot (F100 plan, weekly report).
async function detectWeeklyReport(run: OrgRun): Promise<void> {
  const { db, ctx, now, timeZone } = run;
  const weekStart = lastFinishedWeek(now, timeZone);
  const key = `${ctx.orgId}:${weekStart}`;
  for (const old of failedAt.keys()) {
    if (old.startsWith(`${ctx.orgId}:`) && old !== key) failedAt.delete(old);
  }
  if (!(await isFeatureOn(db, ctx, "weekly_report"))) return;
  const today = localDateTime(now, timeZone);
  if (today.weekday !== 1) return;
  const failed = failedAt.get(key);
  if (failed !== undefined && now.getTime() - failed < WEEKLY_RETRY_MS) return;

  const dedupKey = `weekly_report:${weekStart}`;
  try {
    const due = [];
    for (const member of run.members) {
      const membership = await getMembership(db, ctx, member.userId);
      if (membership === undefined) continue;
      const slot = weeklySlot(parseDigestTimes(membership.digest_times));
      if (localToInstant(today.date, slot, timeZone).getTime() > now.getTime()) continue;
      if ((await findOutboxByDedup(db, ctx, member.userId, dedupKey)) !== undefined) continue;
      due.push(member);
    }
    if (due.length > 0) {
      const { testMail } = run.deps;
      // One snapshot for all members of the organization: each member gets one message, not one per mailbox.
      const week = await weekStats(
        db,
        ctx,
        { weekStart, mailboxId: null, now },
        { urgentNotices: listUrgentNoticeTimes, testMail }
      );
      if (week === "not_found") throw new Error("week stats not found");
      const answeredWaiting = await countAnsweredWaiting(db, ctx, {
        since: new Date(now.getTime() - ANSWERED_WAITING_MS),
        testMail,
      });
      for (const member of due) {
        await queue(
          db,
          ctx,
          {
            userId: member.userId,
            locale: member.locale,
            kind: "weekly_report",
            dedupKey,
            view: { week, timeZone, answeredWaiting },
          },
          now
        );
      }
    }
    failedAt.delete(key);
  } catch (error) {
    failedAt.set(key, now.getTime());
    warnSkipped("weekly_report", `${ctx.orgId}:${weekStart}`, error);
  }
}

export const weeklyReportDetector: Detector = {
  name: "weekly_report",
  kinds: ["weekly_report"],
  detect: detectWeeklyReport,
};
