import {
  lastFinishedWeek,
  localDateTime,
  localToInstant,
  panelUrlSchema,
  parseDigestTimes,
  DAY_MS,
  MINUTE_MS,
} from "@ea/core";

import { countOpenSuggestionsOfOrg } from "../../contacts";
import { weekStats } from "../../reports";
import { getMembership, isFeatureOn } from "../../tenancy";
import { countAnsweredWaiting } from "../../triage";
import { listUrgentNoticeTimes } from "../metrics-repo";
import { findOutboxByDedup } from "../repo";
import { mailDedupKey, reportRoutesOf } from "../report-members";

import { queue, warnSkipped, type Detector, type OrgRun } from "./run";

export const WEEKLY_DEFAULT_TIME = "08:00";
export const WEEKLY_EARLIEST_TIME = "07:00";
export const WEEKLY_RETRY_MS = 15 * MINUTE_MS;
const ANSWERED_WAITING_MS = 14 * DAY_MS;

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

// The rule suggestions that wait, for the weekly line: absent while the flag `sender_suggestions` is off or no row is open (the
// count is 0). The link is the Rules page of the panel; with no `WEB_BASE_URL` the line has a fixed phrase instead.
async function suggestionsOf(run: OrgRun): Promise<{ open: number; panelUrl?: string } | undefined> {
  const open = await countOpenSuggestionsOfOrg(run.db, run.ctx);
  if (open === 0) return undefined;
  const base = run.deps.webBaseUrl;
  const url = panelUrlSchema.safeParse(base === undefined ? "" : `${base.replace(/\/+$/, "")}/rules`);
  return { open, ...(url.success ? { panelUrl: url.data } : {}) };
}

// On Monday, every linked member gets the numbers of the last finished week at the member's own slot (weekly report).
// With the flag `report_mail`, a member whose report channel is `mail` or `both` also gets a mail row (dedup key
// `weekly_report:<week>:mail`), and a `mail` member with no chat gets that row only.
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
    const mailOn = await isFeatureOn(db, ctx, "report_mail");
    const due = [];
    for (const member of run.reportMembers) {
      const routes = reportRoutesOf(member, mailOn);
      if (!routes.telegram && routes.mailboxId === null) continue;
      const membership = await getMembership(db, ctx, member.userId);
      if (membership === undefined) continue;
      const slot = weeklySlot(parseDigestTimes(membership.digest_times));
      if (localToInstant(today.date, slot, timeZone).getTime() > now.getTime()) continue;
      const telegram = routes.telegram && (await findOutboxByDedup(db, ctx, member.userId, dedupKey)) === undefined;
      const mailboxId =
        routes.mailboxId !== null &&
        (await findOutboxByDedup(db, ctx, member.userId, mailDedupKey(dedupKey))) === undefined
          ? routes.mailboxId
          : null;
      if (telegram || mailboxId !== null) due.push({ member, telegram, mailboxId });
    }
    if (due.length > 0) {
      const { testMail, trustEvidence } = run.deps;
      // One snapshot for all members of the organization: each member gets one message, not one per mailbox.
      const week = await weekStats(
        db,
        ctx,
        { weekStart, mailboxId: null, now },
        { urgentNotices: listUrgentNoticeTimes, testMail, ...(trustEvidence === undefined ? {} : { trustEvidence }) }
      );
      if (week === "not_found") throw new Error("week stats not found");
      const answeredWaiting = await countAnsweredWaiting(db, ctx, {
        since: new Date(now.getTime() - ANSWERED_WAITING_MS),
        testMail,
      });
      const suggestions = await suggestionsOf(run);
      for (const { member, telegram, mailboxId } of due) {
        const view = { week, timeZone, answeredWaiting, ...(suggestions === undefined ? {} : { suggestions }) };
        if (telegram) {
          await queue(
            db,
            ctx,
            { userId: member.userId, locale: member.locale, kind: "weekly_report", dedupKey, view },
            now
          );
        }
        if (mailboxId !== null) {
          await queue(
            db,
            ctx,
            {
              userId: member.userId,
              locale: member.locale,
              kind: "weekly_report",
              dedupKey: mailDedupKey(dedupKey),
              view,
              channel: "mail",
              mailboxId,
            },
            now
          );
        }
      }
    }
    failedAt.delete(key);
  } catch (error) {
    failedAt.set(key, now.getTime());
    warnSkipped("weekly_report", ctx.orgId, error, `${ctx.orgId}:${weekStart}`);
  }
}

export const weeklyReportDetector: Detector = {
  name: "weekly_report",
  kinds: ["weekly_report"],
  detect: detectWeeklyReport,
};
