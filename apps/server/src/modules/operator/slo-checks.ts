import {
  HOUR_MS,
  lateMin,
  QUIET_HOURS,
  type QuietHours,
  type SloCheck,
  type SloKind,
  type SloThresholds,
  DAY_MS,
  MINUTE_MS,
} from "@ea/core";
import type { Transaction } from "kysely";
import { z } from "zod";

import type { DB, Db } from "../../platform/db";
import { configCodes, softCodes } from "../../platform/llm";
import { createLog, type Log } from "../../platform/log";
import { countLlmCallOutcomesSince, latestLlmPause } from "../audit";
import { listUrgentCandidates } from "../channels";
import { listLaggingMailboxes, type TestMailRule } from "../mail";
import { isFeatureOn, listOrganizations } from "../tenancy";

// The service-level checks that read the database. They read every organization that is not `suspended` and
// return numbers and ids only. A reading holds no address, subject or text; the ids are UUIDs of mailboxes, mails or
// organizations, at most `MAX_IDS`, never stored (`ops_alerts` has no org_id).

type DbOrTrx = Db | Transaction<DB>;

const log = createLog("operator");

export interface SloReading {
  check: SloCheck;
  ids: string[];
}

export const MAX_IDS = 5;
// After a start the sync and the notices have not run yet: sync lag and urgent give no verdict for this long.
export const SLO_START_GRACE_MS = 10 * MINUTE_MS;
// The urgent check looks at mail of the last 24 h, as the urgent detector does.
export const SLO_URGENT_LOOKBACK_MS = DAY_MS;
// A late notice that went out stops counting this long after it was sent.
export const SLO_URGENT_LATE_MEMORY_MS = HOUR_MS;

function shownIds(ids: Iterable<string>): string[] {
  return [...ids].sort().slice(0, MAX_IDS);
}

function reading(kind: SloKind, state: SloCheck["state"], facts: Record<string, number>, ids: string[]): SloReading {
  return { check: { kind, state, facts }, ids };
}

function inStartGrace(now: Date, startedAt: Date): boolean {
  return now.getTime() - startedAt.getTime() < SLO_START_GRACE_MS;
}

/** Firing: an active mailbox has had no sync, resume or connect for more than `syncLagMin`. Start grace: `between`. */
export async function checkSyncLag(db: DbOrTrx, now: Date, cfg: SloThresholds, startedAt: Date): Promise<SloReading> {
  if (inStartGrace(now, startedAt)) return reading("slo_sync_lag", "between", { mailboxes: 0, max_lag_min: 0 }, []);
  const rows = await listLaggingMailboxes(db, { before: new Date(now.getTime() - cfg.syncLagMin * MINUTE_MS) });
  if (rows.length === 0) return reading("slo_sync_lag", "clear", { mailboxes: 0, max_lag_min: 0 }, []);
  const oldest = Math.min(...rows.map((row) => row.since.getTime()));
  const facts = { mailboxes: rows.length, max_lag_min: Math.floor((now.getTime() - oldest) / MINUTE_MS) };
  return reading("slo_sync_lag", "firing", facts, shownIds(rows.map((row) => row.mailboxId)));
}

/**
 * Firing: an urgent mail that the urgent notice covers waited more than `urgentLatencyMin` minutes outside quiet hours, for
 * its notice or until now. A late notice that went out stops counting 1 h after its send. Start grace: `between`.
 * An organization whose time zone is bad is skipped with one `slo_urgent_zone_bad` warning per tick: its mail gives no verdict,
 * and the other organizations still count.
 */
export async function checkUrgentLatency(
  db: DbOrTrx,
  now: Date,
  cfg: SloThresholds,
  startedAt: Date,
  testMail: TestMailRule,
  logger: Pick<Log, "warn"> = log
): Promise<SloReading> {
  if (inStartGrace(now, startedAt)) return reading("slo_urgent_latency", "between", { mails: 0, max_wait_min: 0 }, []);
  const candidates = await listUrgentCandidates(db, {
    since: new Date(now.getTime() - SLO_URGENT_LOOKBACK_MS),
    testMail,
  });
  const late: { emailId: string; waitMin: number }[] = [];
  const badZoneOrgs = new Set<string>();
  const ownHours = new Map<string, boolean>();
  // With `user_quiet_hours` on, the wait leaves out the quiet hours of the user of the notice. With
  // several pending rows (no notice yet) the largest wait counts: nobody got the notice, each value already leaves out the
  // own quiet hours of its user, so a user in quiet hours cannot hide a user who really waits.
  const hoursOf = async (mail: (typeof candidates)[number]): Promise<QuietHours[]> => {
    let on = ownHours.get(mail.orgId);
    if (on === undefined) {
      on = await isFeatureOn(db, { orgId: mail.orgId }, "user_quiet_hours");
      ownHours.set(mail.orgId, on);
    }
    return on && mail.quiet.length > 0 ? mail.quiet : [QUIET_HOURS];
  };
  for (const mail of candidates) {
    if (badZoneOrgs.has(mail.orgId)) continue;
    if (mail.noticeAt !== null && mail.noticeAt.getTime() < now.getTime() - SLO_URGENT_LATE_MEMORY_MS) continue;
    // Read outside the `try`: a database error must fail the reading, not count as a bad time zone.
    const hours = await hoursOf(mail);
    let waitMin: number;
    try {
      const end = mail.noticeAt ?? now;
      waitMin = Math.max(...hours.map((quiet) => lateMin(mail.startAt, end, mail.timeZone, quiet)));
    } catch {
      // `Intl` throws a RangeError for a time zone it does not know. One organization must not fail the whole reading.
      badZoneOrgs.add(mail.orgId);
      logger.warn("slo_urgent_zone_bad", { org_id: mail.orgId });
      continue;
    }
    if (waitMin > cfg.urgentLatencyMin) late.push({ emailId: mail.emailId, waitMin });
  }
  if (late.length === 0) return reading("slo_urgent_latency", "clear", { mails: 0, max_wait_min: 0 }, []);
  const facts = { mails: late.length, max_wait_min: Math.floor(Math.max(...late.map((mail) => mail.waitMin))) };
  return reading("slo_urgent_latency", "firing", facts, shownIds(late.map((mail) => mail.emailId)));
}

/**
 * Firing: in the last `llmWindowMin` minutes at least `llmMinCalls` calls and `llmFailPct` percent of them failed, or an
 * organization is paused by a spent quota (`http_429_quota`). Clear: too few calls or less than `llmClearPct` percent, and no
 * quota pause. Else `between`.
 */
export async function checkLlmErrors(db: DbOrTrx, now: Date, cfg: SloThresholds): Promise<SloReading> {
  const since = new Date(now.getTime() - cfg.llmWindowMin * MINUTE_MS);
  const { total, failed } = await countLlmCallOutcomesSince(db, since);
  const pct = total === 0 ? 0 : (failed / total) * 100;
  const quotaOrgs: string[] = [];
  for (const org of await listOrganizations(db)) {
    if (org.plan === "suspended") continue;
    const pause = await latestLlmPause(db, { orgId: org.id }, { now, softCodes, configCodes });
    if (pause?.code === "http_429_quota") quotaOrgs.push(org.id);
  }
  const facts = { calls: total, failed, pct: Math.round(pct * 10) / 10, quota_orgs: quotaOrgs.length };
  const enough = total >= cfg.llmMinCalls;
  const ids = shownIds(quotaOrgs);
  if ((enough && pct >= cfg.llmFailPct) || quotaOrgs.length > 0) return reading("slo_llm_errors", "firing", facts, ids);
  if (!enough || pct < cfg.llmClearPct) return reading("slo_llm_errors", "clear", facts, ids);
  return reading("slo_llm_errors", "between", facts, ids);
}

const GIB = 1024 ** 3;
// The disk clears 5 percentage points and 0.5 GB above the open values (a hysteresis band, so a value on the line does not flap).
const DISK_CLEAR_PCT = 5;
const DISK_CLEAR_GB = 0.5;

/** `statfs` of `node:fs/promises`, as much of it as the check reads. */
export type StatFs = (path: string) => Promise<{ bavail: number; blocks: number; bsize: number }>;

const oneDecimal = (value: number): number => Math.round(value * 10) / 10;

/**
 * Free space of the volume `cfg.diskPath` (`bavail` blocks are the ones an unprivileged process may use; GB means 1024^3 bytes, as
 * `df -h` shows). Firing: free percent below `diskFreePct` or free GB below `diskFreeGb`. Clear: both at least 5 points and 0.5 GB
 * above them. Else `between`. A volume that cannot be read throws: the job logs `slo_check_failed` and skips the kind this tick.
 */
export async function checkDisk(
  statfs: StatFs,
  cfg: Pick<SloThresholds, "diskPath" | "diskFreePct" | "diskFreeGb">
): Promise<SloReading> {
  const { bavail, blocks, bsize } = await statfs(cfg.diskPath);
  if (!(blocks > 0) || !(bsize > 0) || !(bavail >= 0)) throw new RangeError("statfs gave no usable block counts");
  const freePct = (bavail * 100) / blocks;
  const freeGb = (bavail * bsize) / GIB;
  const facts = { free_pct: oneDecimal(freePct), free_gb: oneDecimal(freeGb) };
  if (freePct < cfg.diskFreePct || freeGb < cfg.diskFreeGb) return reading("slo_disk", "firing", facts, []);
  if (freePct >= cfg.diskFreePct + DISK_CLEAR_PCT && freeGb >= cfg.diskFreeGb + DISK_CLEAR_GB) {
    return reading("slo_disk", "clear", facts, []);
  }
  return reading("slo_disk", "between", facts, []);
}

// The shape that `deploy/backup.sh` writes (one JSON line).
const backupStatusSchema = z.object({
  result: z.enum(["ok", "failed"]),
  at: z.iso.datetime(),
  name: z.string().nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  last_ok_at: z.iso.datetime().nullable(),
});

/**
 * The backup check. `null` when `BACKUP_STATUS_FILE` is empty (check off). Firing: the file is missing, unreadable or has a bad
 * shape (`missing` 1, `age_h` -1), the last run failed (`failed` 1), or the last good backup is older than `backupMaxAgeH` hours.
 * Else clear; there is no `between` state. `age_h` is the whole hours since the last good backup, -1 when none is on record.
 */
export async function checkBackupAge(
  readFile: (path: string) => Promise<string>,
  now: Date,
  cfg: Pick<SloThresholds, "backupMaxAgeH" | "backupStatusFile">
): Promise<SloReading | null> {
  if (cfg.backupStatusFile === null) return null;
  let status: z.infer<typeof backupStatusSchema>;
  try {
    status = backupStatusSchema.parse(JSON.parse(await readFile(cfg.backupStatusFile)));
  } catch {
    return reading("slo_backup_age", "firing", { age_h: -1, failed: 0, missing: 1 }, []);
  }
  const lastOk = status.last_ok_at === null ? null : new Date(status.last_ok_at);
  const ageMs = lastOk === null ? null : Math.max(0, now.getTime() - lastOk.getTime());
  const facts = {
    age_h: ageMs === null ? -1 : Math.floor(ageMs / HOUR_MS),
    failed: status.result === "failed" ? 1 : 0,
    missing: 0,
  };
  const stale = ageMs === null || ageMs > cfg.backupMaxAgeH * HOUR_MS;
  return reading("slo_backup_age", status.result === "failed" || stale ? "firing" : "clear", facts, []);
}
