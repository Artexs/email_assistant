import { lateMin, type SloCheck, type SloKind, type SloThresholds } from "@ea/core";
import type { Transaction } from "kysely";

import type { DB, Db } from "../../platform/db";
import { configCodes, softCodes } from "../../platform/llm";
import { countLlmCallOutcomesSince, latestLlmPause } from "../audit";
import { listUrgentCandidates } from "../channels";
import { listLaggingMailboxes, type TestMailRule } from "../mail";
import { listOrganizations } from "../tenancy";

// F114 stage 02: the service-level checks that read the database. They read every organization that is not `suspended` and
// return numbers and ids only. A reading holds no address, subject or text; the ids are UUIDs of mailboxes, mails or
// organizations, at most `MAX_IDS`, never stored (`ops_alerts` has no org_id).

type DbOrTrx = Db | Transaction<DB>;

export interface SloReading {
  check: SloCheck;
  ids: string[];
}

export const MAX_IDS = 5;
// After a start the sync and the notices have not run yet: sync lag and urgent give no verdict for this long.
export const SLO_START_GRACE_MS = 10 * 60_000;
// The urgent check looks at mail of the last 24 h, as the urgent detector does.
export const SLO_URGENT_LOOKBACK_MS = 24 * 3_600_000;
// A late notice that went out stops counting this long after it was sent.
export const SLO_URGENT_LATE_MEMORY_MS = 3_600_000;
const MINUTE_MS = 60_000;

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
 */
export async function checkUrgentLatency(
  db: DbOrTrx,
  now: Date,
  cfg: SloThresholds,
  startedAt: Date,
  testMail: TestMailRule
): Promise<SloReading> {
  if (inStartGrace(now, startedAt)) return reading("slo_urgent_latency", "between", { mails: 0, max_wait_min: 0 }, []);
  const candidates = await listUrgentCandidates(db, {
    since: new Date(now.getTime() - SLO_URGENT_LOOKBACK_MS),
    testMail,
  });
  const late: { emailId: string; waitMin: number }[] = [];
  for (const mail of candidates) {
    if (mail.noticeAt !== null && mail.noticeAt.getTime() < now.getTime() - SLO_URGENT_LATE_MEMORY_MS) continue;
    const waitMin = lateMin(mail.startAt, mail.noticeAt ?? now, mail.timeZone);
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
