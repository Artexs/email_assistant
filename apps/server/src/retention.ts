import type { Transaction } from "kysely";

import { clearActionErrors, clearActionPayloads } from "./modules/actions";
import { clearOutboxTexts, deleteOldLinkTokens } from "./modules/channels";
import { clearDelegationTasks } from "./modules/delegation";
import { clearMailBodies, clearMailHeaders } from "./modules/mail";
import { listOrganizations } from "./modules/tenancy";
import { clearTriageTexts } from "./modules/triage";
import type { DB, Db } from "./platform/db";
import { describeError } from "./platform/errors";
import { createLog } from "./platform/log";

const log = createLog("retention");

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// A23: every text of the §7 list goes after this period, except the mail body (the organization's `data_retention_days`).
export const RETENTION_TEXT_DAYS = 90;
// A pending mail that no job took in this time loses its body at the same run.
const PENDING_BODY_DAYS = 7;
export const LINK_TOKEN_GRACE_MS = 24 * HOUR_MS;

export interface RetentionCounts {
  body: number;
  headers: number;
  triage: number;
  payloads: number;
  errors: number;
  tasks: number;
  outbox: number;
  tokens: number;
}

export interface Clearers {
  clearMailBodies: typeof clearMailBodies;
  clearMailHeaders: typeof clearMailHeaders;
  clearTriageTexts: typeof clearTriageTexts;
  clearActionPayloads: typeof clearActionPayloads;
  clearActionErrors: typeof clearActionErrors;
  clearDelegationTasks: typeof clearDelegationTasks;
  clearOutboxTexts: typeof clearOutboxTexts;
  deleteOldLinkTokens: typeof deleteOldLinkTokens;
}

export interface RetentionJobDeps {
  db: Db | Transaction<DB>;
  now: () => Date;
  // Only for the test of an error in one organization (the `triageOne` pattern); the default is the module functions.
  clearers?: Partial<Clearers>;
}

export interface RetentionJob {
  run(): Promise<void>;
  runOrg(org: { id: string; dataRetentionDays: number }, now: Date): Promise<RetentionCounts>;
}

const sumOf = (counts: RetentionCounts): number => Object.values(counts).reduce((sum, count) => sum + count, 0);

// Daily job (A23, A24): clears the texts of every organization of every plan, a suspended one too.
// Each clear function runs its own batches; there is no transaction around them, and a crash in the middle is safe to repeat.
// The log has counts and the organization id only: no text, no mail id.
export function createRetentionJob(deps: RetentionJobDeps): RetentionJob {
  const { db } = deps;
  const clearers: Clearers = {
    clearMailBodies,
    clearMailHeaders,
    clearTriageTexts,
    clearActionPayloads,
    clearActionErrors,
    clearDelegationTasks,
    clearOutboxTexts,
    deleteOldLinkTokens,
    ...deps.clearers,
  };

  async function runOrg(org: { id: string; dataRetentionDays: number }, now: Date): Promise<RetentionCounts> {
    const ctx = { orgId: org.id };
    const textsBefore = new Date(now.getTime() - RETENTION_TEXT_DAYS * DAY_MS);
    const body = await clearers.clearMailBodies(db, ctx, {
      before: new Date(now.getTime() - org.dataRetentionDays * DAY_MS),
      pendingBefore: new Date(now.getTime() - PENDING_BODY_DAYS * DAY_MS),
    });
    const headers = await clearers.clearMailHeaders(db, ctx, { before: textsBefore });
    const triage = await clearers.clearTriageTexts(db, ctx, { before: textsBefore });
    const payloads = await clearers.clearActionPayloads(db, ctx, { before: textsBefore });
    const errors = await clearers.clearActionErrors(db, ctx, { before: textsBefore });
    const tasks = await clearers.clearDelegationTasks(db, ctx, { before: textsBefore });
    const outbox = await clearers.clearOutboxTexts(db, ctx, { before: textsBefore });
    const tokens = await clearers.deleteOldLinkTokens(db, ctx, {
      before: new Date(now.getTime() - LINK_TOKEN_GRACE_MS),
    });
    const counts = { body, headers, triage, payloads, errors, tasks, outbox, tokens };
    if (sumOf(counts) > 0) {
      log.info(
        `retention org ${org.id}: body ${body}, headers ${headers}, triage ${triage}, payloads ${payloads}, errors ${errors}, tasks ${tasks}, outbox ${outbox}, tokens ${tokens}`
      );
    }
    return counts;
  }

  // Never throws.
  async function run(): Promise<void> {
    try {
      const now = deps.now();
      const orgs = await listOrganizations(db);
      let total = 0;
      for (const org of orgs) {
        try {
          total += sumOf(await runOrg(org, now));
        } catch (error) {
          log.error(`retention org ${org.id} failed: ${describeError(error)}`);
        }
      }
      log.info(`retention: ${orgs.length} organizations, ${total} rows`);
    } catch (error) {
      log.error(`retention failed: ${describeError(error)}`);
    }
  }

  return { run, runOrg };
}
