import { parseToolSwitches, type ReplyLanguage } from "@ea/core";

import type { TenantContext } from "../../platform/db";
import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { getMailboxSettings } from "../config";
import { getMailbox, listSyncTargets, mailboxProfileOf } from "../mail";
import { getOrganization, getOrgOwner, isFeatureOn, isOrgSuspended } from "../tenancy";
import { createLlmPause, type LlmPause } from "../triage";

import {
  draftOne,
  recoverRequest,
  USER_REQUEST_TIMEOUT_MS,
  type DraftDeps,
  type DraftOutcome,
  type MailboxEnv,
} from "./draft-one";
import { claimReplyRequests, createReplyRequest, failStaleUserRequests, releaseReplyRequest } from "./repo/requests";
import { scanReplyCandidates } from "./repo/scan";

const log = createLog("replies");

// The scan makes at most this many automatic requests per mailbox and run; a run claims at most this many per mailbox.
export const SCAN_LIMIT = 50;
export const CLAIM_LIMIT = 5;

export type ReplyJobDeps = Omit<DraftDeps, "pause"> & {
  // The pause of this job: a quota or key error of the model stops all mailboxes for a while. Default: a new one.
  pause?: LlmPause;
  // Requests claimed per mailbox and run (default 5). A test sets 1 to put two requests of one thread into two runs.
  claimLimit?: number;
};

export interface ReplyRunResult {
  mailboxes: number;
  mailboxErrors: number;
  // Automatic requests that the scan made.
  requested: number;
  claimed: number;
  // Requests that a user waited for and that ended `timeout` without a claim.
  timedOut: number;
  outcomes: Record<DraftOutcome, number>;
}

const emptyResult = (): ReplyRunResult => ({
  mailboxes: 0,
  mailboxErrors: 0,
  requested: 0,
  claimed: 0,
  timedOut: 0,
  outcomes: { done: 0, no_draft: 0, failed: 0, cancelled: 0, superseded: 0, waiting: 0, retry: 0, lost: 0 },
});

export interface ReplyJobs {
  // `replies.drafter`, every 15 seconds: the scan for automatic requests, then the claim and the draft of each request.
  // `mailboxId`: only this mailbox (tests and one-mailbox runs); the gates and the claim are the same.
  drafter: { run(opts?: { mailboxId?: string }): Promise<ReplyRunResult> };
}

function ownerLocaleOf(locale: string | null | undefined): ReplyLanguage | null {
  return locale === "pl" || locale === "en" ? locale : null;
}

// Everything one mailbox needs, read once per run. Undefined: the mailbox or the organization is gone.
async function mailboxEnv(deps: ReplyJobDeps, ctx: TenantContext, mailboxId: string): Promise<MailboxEnv | undefined> {
  const [mailbox, organization, settings, owner, profile, flagOn] = await Promise.all([
    getMailbox(deps.db, ctx, mailboxId),
    getOrganization(deps.db, ctx),
    getMailboxSettings(deps.db, ctx, mailboxId),
    getOrgOwner(deps.db, ctx),
    mailboxProfileOf(deps.db, ctx, mailboxId),
    isFeatureOn(deps.db, ctx, "reply_drafts"),
  ]);
  if (mailbox === undefined || organization === undefined) return undefined;
  return {
    mailboxId,
    address: mailbox.address,
    // Reply drafts are for password IMAP mailboxes until the OAuth providers get them.
    oauth: mailbox.oauth_provider !== null,
    timezone: organization.timezone,
    owner: owner === undefined ? undefined : { displayName: owner.displayName, locale: ownerLocaleOf(owner.locale) },
    profile,
    flagOn,
    assist: settings?.mode === "assist",
    switchOn: settings !== undefined && parseToolSwitches(settings.tool_switches).reply_drafts,
  };
}

// The jobs of the module `replies`. A later stage adds the sweep.
export function createReplyJobs(rawDeps: ReplyJobDeps): ReplyJobs {
  const pause = rawDeps.pause ?? createLlmPause();
  const deps: DraftDeps = { ...rawDeps, pause };
  // One warning per mailbox and quota day.
  const warnedCap = new Set<string>();

  async function runMailbox(ctx: TenantContext, mailboxId: string, total: ReplyRunResult): Promise<void> {
    const mailboxLog = log.with({ org_id: ctx.orgId, mailbox_id: mailboxId });
    const now = deps.now();

    // A request that a user waits for and that no run can take (it waits for the pause or for a gate) still ends in time.
    const stale = await failStaleUserRequests(deps.db, ctx, mailboxId, {
      createdBefore: new Date(now.getTime() - USER_REQUEST_TIMEOUT_MS),
      now,
    });
    for (const id of stale) mailboxLog.warn("reply_draft_failed", { reply_request_id: id, error_code: "timeout" });
    total.timedOut += stale.length;
    if (pause.isPaused(now)) return;

    const env = await mailboxEnv(deps, ctx, mailboxId);
    if (env === undefined) return;
    total.mailboxes += 1;

    // The scan runs only while every gate is open: flag, mode `assist`, the switch, a password mailbox. Requests that already exist
    // are claimed in any case: the draft step cancels them with the reason.
    if (env.flagOn && env.assist && env.switchOn && !env.oauth) {
      const candidates = await scanReplyCandidates(deps.db, ctx, mailboxId, {
        now,
        limit: SCAN_LIMIT,
        testOnly: deps.scope.kind === "synthetic" ? deps.scope.testMail : null,
      });
      for (const candidate of candidates) {
        const id = await createReplyRequest(deps.db, ctx, {
          mailboxId,
          emailId: candidate.emailId,
          threadKey: candidate.threadKey,
          folder: candidate.folder,
          trigger: "auto",
          // The request is due at once, by the clock of the job (not by the clock of the database).
          nextAttemptAt: now,
        });
        if (id !== null) total.requested += 1;
      }
    }

    const claimed = await claimReplyRequests(deps.db, ctx, {
      mailboxId,
      now,
      limit: rawDeps.claimLimit ?? CLAIM_LIMIT,
    });
    total.claimed += claimed.length;
    for (const [index, row] of claimed.entries()) {
      // A pause that a call tripped stops the rest of the batch: the requests go back with no try counted.
      if (pause.isPaused(deps.now())) {
        for (const untried of claimed.slice(index)) {
          if (untried.locked_at === null) continue;
          await releaseReplyRequest(deps.db, ctx, untried.id, untried.locked_at, {
            nextAttemptAt: untried.next_attempt_at,
            countAttempt: false,
            now: deps.now(),
          }).catch((error: unknown) =>
            mailboxLog.warn("reply_release_failed", { reply_request_id: untried.id, ...errorFields(error) })
          );
        }
        return;
      }
      try {
        total.outcomes[await draftOne(deps, ctx, env, row, warnedCap)] += 1;
      } catch (error) {
        await recoverRequest(deps, ctx, mailboxId, row, error);
        total.outcomes.retry += 1;
      }
    }
  }

  return {
    drafter: {
      async run(opts) {
        const total = emptyResult();
        const targets = await listSyncTargets(deps.db);
        for (const { orgId, mailboxId } of targets) {
          if (opts?.mailboxId !== undefined && opts.mailboxId !== mailboxId) continue;
          const ctx = { orgId };
          try {
            // A suspend during the run stops the next mailbox, not only the next run.
            if (await isOrgSuspended(deps.db, ctx)) continue;
            await runMailbox(ctx, mailboxId, total);
          } catch (error) {
            // The error of one mailbox does not stop the next.
            total.mailboxErrors += 1;
            log.with({ org_id: orgId, mailbox_id: mailboxId }).error("replies_mailbox_failed", errorFields(error));
          }
        }
        return total;
      },
    },
  };
}
