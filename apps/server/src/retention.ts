import type { Transaction } from "kysely";

import { clearActionErrors, clearActionPayloads } from "./modules/actions";
import { clearOutboxTexts, deleteOldLinkTokens } from "./modules/channels";
import { clearDelegationTasks, isOpenDelegationDraft } from "./modules/delegation";
import { clearMailBodies, clearMailHeaders, PENDING_BODY_DAYS } from "./modules/mail";
import { listOrganizations } from "./modules/tenancy";
import { clearTriageTexts } from "./modules/triage";
import { deleteExpiredVerifications } from "./platform/auth";
import type { DB, Db } from "./platform/db";
import { describeError, errorFields } from "./platform/errors";
import { createLog } from "./platform/log";

const log = createLog("retention");

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// A23: every text of the §7 list goes after this period, except the mail body (the organization's `data_retention_days`).
export const RETENTION_TEXT_DAYS = 90;
export const LINK_TOKEN_GRACE_MS = 24 * HOUR_MS;
// A reset or invite token row goes this long after it expired.
export const VERIFICATION_GRACE_MS = 24 * HOUR_MS;

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
  deleteExpiredVerifications: typeof deleteExpiredVerifications;
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
// The log has counts and the organization id only: no text, no mail id. The expired Better Auth verification rows go once per run, not per organization.
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
    deleteExpiredVerifications,
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
    const payloads = await clearers.clearActionPayloads(db, ctx, { before: textsBefore, keep: isOpenDelegationDraft });
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

  // The Better Auth table belongs to no organization, so the run clears it once. Never throws; a failure leaves the rows for the next day.
  async function deleteVerifications(now: Date): Promise<number> {
    try {
      const count = await clearers.deleteExpiredVerifications(db, {
        before: new Date(now.getTime() - VERIFICATION_GRACE_MS),
      });
      if (count > 0) log.info("retention_auth_verifications_deleted", { count });
      return count;
    } catch (error) {
      log.error("retention_auth_verifications_failed", { ...errorFields(error) });
      return 0;
    }
  }

  // Never throws.
  async function run(): Promise<void> {
    try {
      const now = deps.now();
      const orgs = await listOrganizations(db);
      let total = await deleteVerifications(now);
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
