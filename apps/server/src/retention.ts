import { DAY_MS, HOUR_MS } from "@ea/core";
import type { Transaction } from "kysely";

import { clearActionErrors, clearActionPayloads } from "./modules/actions";
import { clearOutboxTexts, deleteOldLinkTokens } from "./modules/channels";
import { deleteEndedSuggestions, deleteOldProfiles } from "./modules/contacts";
import { clearDelegationTasks, isOpenDelegationDraft } from "./modules/delegation";
import { clearLoopTexts } from "./modules/loops";
import {
  clearCapturedHeaders,
  clearMailBodies,
  clearMailHeaders,
  clearSentBodies,
  clearSentHeaders,
  deleteOldOAuthStates,
  PENDING_BODY_DAYS,
} from "./modules/mail";
import { clearReplyTexts } from "./modules/replies";
import { listOrganizations } from "./modules/tenancy";
import { clearTriageTexts } from "./modules/triage";
import { deleteExpiredVerifications } from "./platform/auth";
import type { DB, Db } from "./platform/db";
import { errorFields } from "./platform/errors";
import { createLog } from "./platform/log";

const log = createLog("retention");

// Every text of the §7 list goes after this period, except the mail body (the organization's `data_retention_days`).
export const RETENTION_TEXT_DAYS = 90;
export const LINK_TOKEN_GRACE_MS = DAY_MS;
// An OAuth sign-in state row goes this long after it expired.
export const OAUTH_STATE_GRACE_MS = HOUR_MS;
// A reset or invite token row goes this long after it expired.
export const VERIFICATION_GRACE_MS = DAY_MS;
// A sender profile goes this long after the newest date it holds (data category `sender-context`).
export const PROFILE_RETENTION_DAYS = 365;
// An ended rule suggestion goes this long after its end; an open one that nobody answered ends as `expired` after the second period.
export const SUGGESTION_ENDED_DAYS = 90;
export const SUGGESTION_OPEN_DAYS = 30;

export interface RetentionCounts {
  body: number;
  headers: number;
  sentBody: number;
  sentHeaders: number;
  capturedHeaders: number;
  triage: number;
  payloads: number;
  errors: number;
  tasks: number;
  outbox: number;
  loops: number;
  replyTexts: number;
  tokens: number;
  // Sender profiles deleted.
  profiles: number;
  // Rule suggestions expired plus deleted.
  suggestions: number;
}

export interface Clearers {
  clearMailBodies: typeof clearMailBodies;
  clearMailHeaders: typeof clearMailHeaders;
  clearSentBodies: typeof clearSentBodies;
  clearSentHeaders: typeof clearSentHeaders;
  clearCapturedHeaders: typeof clearCapturedHeaders;
  clearTriageTexts: typeof clearTriageTexts;
  clearActionPayloads: typeof clearActionPayloads;
  clearActionErrors: typeof clearActionErrors;
  clearDelegationTasks: typeof clearDelegationTasks;
  clearOutboxTexts: typeof clearOutboxTexts;
  clearLoopTexts: typeof clearLoopTexts;
  clearReplyTexts: typeof clearReplyTexts;
  deleteOldLinkTokens: typeof deleteOldLinkTokens;
  deleteOldOAuthStates: typeof deleteOldOAuthStates;
  deleteExpiredVerifications: typeof deleteExpiredVerifications;
  deleteOldProfiles: typeof deleteOldProfiles;
  deleteEndedSuggestions: typeof deleteEndedSuggestions;
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

// Daily job: clears the texts of every organization of every plan, a suspended one too.
// Each clear function runs its own batches; there is no transaction around them, and a crash in the middle is safe to repeat.
// The log has counts and the organization id only: no text, no mail id. The expired Better Auth verification rows go once per run, not per organization.
export function createRetentionJob(deps: RetentionJobDeps): RetentionJob {
  const { db } = deps;
  const clearers: Clearers = {
    clearMailBodies,
    clearMailHeaders,
    clearSentBodies,
    clearSentHeaders,
    clearCapturedHeaders,
    clearTriageTexts,
    clearActionPayloads,
    clearActionErrors,
    clearDelegationTasks,
    clearOutboxTexts,
    clearLoopTexts,
    clearReplyTexts,
    deleteOldLinkTokens,
    deleteOldOAuthStates,
    deleteExpiredVerifications,
    deleteOldProfiles,
    deleteEndedSuggestions,
    ...deps.clearers,
  };

  async function runOrg(org: { id: string; dataRetentionDays: number }, now: Date): Promise<RetentionCounts> {
    const ctx = { orgId: org.id };
    const textsBefore = new Date(now.getTime() - RETENTION_TEXT_DAYS * DAY_MS);
    const bodyBefore = new Date(now.getTime() - org.dataRetentionDays * DAY_MS);
    const body = await clearers.clearMailBodies(db, ctx, {
      before: bodyBefore,
      pendingBefore: new Date(now.getTime() - PENDING_BODY_DAYS * DAY_MS),
    });
    const headers = await clearers.clearMailHeaders(db, ctx, { before: textsBefore });
    // The Sent text goes after the organization's period, the Sent subject and addresses after 90 days: both from the Sent INTERNALDATE.
    const sentBody = await clearers.clearSentBodies(db, ctx, { before: bodyBefore });
    const sentHeaders = await clearers.clearSentHeaders(db, ctx, { before: textsBefore });
    // The captured header texts go with the mail body, after the organization's period.
    const capturedHeaders = await clearers.clearCapturedHeaders(db, ctx, { before: bodyBefore });
    const triage = await clearers.clearTriageTexts(db, ctx, { before: textsBefore });
    const payloads = await clearers.clearActionPayloads(db, ctx, { before: textsBefore, keep: isOpenDelegationDraft });
    const errors = await clearers.clearActionErrors(db, ctx, { before: textsBefore });
    const tasks = await clearers.clearDelegationTasks(db, ctx, { before: textsBefore });
    const outbox = await clearers.clearOutboxTexts(db, ctx, { before: textsBefore });
    // The loop texts go 90 days after the loop closed; an open loop keeps them.
    const loops = await clearers.clearLoopTexts(db, ctx, { before: textsBefore, now });
    // The reply instruction and the sample text go after the text period (not the organization's), counted from `created_at`.
    const replyTexts = await clearers.clearReplyTexts(db, ctx, { before: textsBefore });
    // The `tokens` count holds the link tokens and the OAuth sign-in states.
    const tokens =
      (await clearers.deleteOldLinkTokens(db, ctx, { before: new Date(now.getTime() - LINK_TOKEN_GRACE_MS) })) +
      (await clearers.deleteOldOAuthStates(db, ctx, { before: new Date(now.getTime() - OAUTH_STATE_GRACE_MS) }));
    // The sender context: the flags decide nothing here, so the data of a switched-off `sender_context` still ages out.
    const profiles = await clearers.deleteOldProfiles(db, ctx, {
      before: new Date(now.getTime() - PROFILE_RETENTION_DAYS * DAY_MS),
    });
    const suggestions = await clearers.deleteEndedSuggestions(db, ctx, {
      before: new Date(now.getTime() - SUGGESTION_ENDED_DAYS * DAY_MS),
      openBefore: new Date(now.getTime() - SUGGESTION_OPEN_DAYS * DAY_MS),
      now,
    });
    const counts = {
      body,
      headers,
      sentBody,
      sentHeaders,
      capturedHeaders,
      triage,
      payloads,
      errors,
      tasks,
      outbox,
      loops,
      replyTexts,
      tokens,
      profiles,
      suggestions,
    };
    if (sumOf(counts) > 0) {
      log.info("retention_org_done", {
        org_id: org.id,
        body_rows: body,
        header_rows: headers,
        sent_body_rows: sentBody,
        sent_header_rows: sentHeaders,
        captured_header_rows: capturedHeaders,
        triage_rows: triage,
        payload_rows: payloads,
        error_rows: errors,
        task_rows: tasks,
        outbox_rows: outbox,
        loop_rows: loops,
        reply_text_rows: replyTexts,
        token_rows: tokens,
        profile_rows: profiles,
        suggestion_rows: suggestions,
      });
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
          log.error("retention_org_failed", { org_id: org.id, ...errorFields(error) });
        }
      }
      log.info("retention_done", { org_count: orgs.length, count: total });
    } catch (error) {
      log.error("retention_failed", { ...errorFields(error) });
    }
  }

  return { run, runOrg };
}
