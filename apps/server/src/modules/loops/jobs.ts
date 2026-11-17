import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { listSyncTargets } from "../mail";
import { isFeatureOn, isOrgSuspended } from "../tenancy";
import { createLlmPause } from "../triage";

import { type AnalyzeDeps, analyzeSent, DEFAULT_LIMIT, emptyResult, type AnalyzeResult } from "./analyze";
import { runLoopChaser, type LoopChaserDeps, type LoopChaserResult } from "./chaser";
import { emptyMatchResult, matchReplies, type MatchResult } from "./match";
import type { DbOrTrx } from "./repo";

const log = createLog("loops");

export interface LoopJobDeps extends Omit<AnalyzeDeps, "pause"> {
  now(): Date;
  // Rows per mailbox and run; default 20.
  limit?: number;
  // Only for tests of an error outside the model call.
  analyze?: typeof analyzeSent;
}

export interface LoopJobs {
  // `loops.analyze`: the analysis of the Sent mail, every 60 seconds. Returns the counts of the run.
  analyze: { run(): Promise<AnalyzeResult & { mailboxes: number; mailboxErrors: number }> };
}

// The jobs of the module `loops`. A later stage adds the chaser.
export function createLoopJobs(deps: LoopJobDeps): LoopJobs {
  // The pause belongs to this job: a wrong key of the extractor role must not pause the triage worker.
  const pause = createLlmPause();
  const analyzeDeps: AnalyzeDeps = { ...deps, pause };

  return {
    analyze: {
      async run() {
        const total = { ...emptyResult(), mailboxes: 0, mailboxErrors: 0 };
        const targets = await listSyncTargets(deps.db);
        for (const { orgId, mailboxId } of targets) {
          const ctx = { orgId };
          try {
            // A suspend during the run stops the next mailbox, not only the next run.
            if (await isOrgSuspended(deps.db, ctx)) continue;
            const out = await (deps.analyze ?? analyzeSent)(analyzeDeps, ctx, mailboxId, {
              now: deps.now(),
              limit: deps.limit ?? DEFAULT_LIMIT,
            });
            total.mailboxes += 1;
            total.analysed += out.analysed;
            total.skipped += out.skipped;
            total.opened += out.opened;
            total.restarted += out.restarted;
            total.promisesClosed += out.promisesClosed;
            total.waiting += out.waiting;
            total.failed += out.failed;
            // The quota or the key is per project: the next mailbox would meet the same error.
            if (out.stopped) {
              total.stopped = true;
              break;
            }
          } catch (error) {
            // The error of one mailbox does not stop the next.
            total.mailboxErrors += 1;
            log
              .with({ org_id: orgId, mailbox_id: mailboxId })
              .error("sent_analysis_mailbox_failed", errorFields(error));
          }
        }
        return total;
      },
    },
  };
}

export interface LoopMatchJobDeps {
  db: DbOrTrx;
  now(): Date;
  // Only for tests of an error outside the match.
  match?: typeof matchReplies;
}

export interface LoopMatchJob {
  // `loops.match`: the close rules for the open loops, every 2 minutes. Needs no model: it runs with the scope off.
  run(): Promise<MatchResult & { mailboxes: number; mailboxErrors: number }>;
}

export function createLoopMatchJob(deps: LoopMatchJobDeps): LoopMatchJob {
  return {
    async run() {
      const total = { ...emptyMatchResult(), mailboxes: 0, mailboxErrors: 0 };
      const targets = await listSyncTargets(deps.db);
      for (const { orgId, mailboxId } of targets) {
        const ctx = { orgId };
        try {
          if ((await isOrgSuspended(deps.db, ctx)) || !(await isFeatureOn(deps.db, ctx, "open_loops"))) continue;
          const out = await (deps.match ?? matchReplies)(deps, ctx, mailboxId, { now: deps.now() });
          total.mailboxes += 1;
          total.checked += out.checked;
          total.replied += out.replied;
          total.repliedSubject += out.repliedSubject;
          total.dropped += out.dropped;
          total.autoMarked += out.autoMarked;
        } catch (error) {
          // The error of one mailbox does not stop the next.
          total.mailboxErrors += 1;
          log.with({ org_id: orgId, mailbox_id: mailboxId }).error("loops_match_mailbox_failed", errorFields(error));
        }
      }
      return total;
    },
  };
}

export interface LoopChaserJobDeps extends LoopChaserDeps {
  // Only for tests of an error outside the run.
  run?: typeof runLoopChaser;
}

export interface LoopChaserJob {
  // `loops.chaser`: the one chaser (delegation reminders, loop follow-ups, stale and expired closes). Each tick visits every
  // mailbox; a mailbox acts once per local day from 07:30. `force` skips both gates.
  run(opts?: { force?: boolean }): Promise<LoopChaserResult & { mailboxes: number; mailboxErrors: number }>;
}

export function createLoopChaserJob(deps: LoopChaserJobDeps): LoopChaserJob {
  // One line per mailbox and reason, not one per tick.
  const warnedSettings = new Set<string>();
  const warnedSkips = new Set<string>();
  return {
    async run(opts) {
      const total = { ...skipped(), mailboxes: 0, mailboxErrors: 0 };
      const targets = await listSyncTargets(deps.db);
      for (const { orgId, mailboxId } of targets) {
        const ctx = { orgId };
        const mailboxLog = log.with({ org_id: orgId, mailbox_id: mailboxId });
        try {
          if (await isOrgSuspended(deps.db, ctx)) continue;
          if (opts?.force === true) mailboxLog.info("chaser_forced");
          const result = await (deps.run ?? runLoopChaser)(deps, ctx, mailboxId, {
            now: deps.now(),
            force: opts?.force === true,
          });
          if (result.skipped === null) {
            total.mailboxes += 1;
            for (const key of ["due", "overdue", "reminders", "followUps", "stale", "expired"] as const)
              total[key] += result[key];
          } else if (result.skipped === "settings" && !warnedSettings.has(mailboxId)) {
            warnedSettings.add(mailboxId);
            mailboxLog.info("chaser_skipped_settings");
          } else if (result.skipped === "gate" && !warnedSkips.has(`${mailboxId}:gate`)) {
            warnedSkips.add(`${mailboxId}:gate`);
            mailboxLog.info("chaser_skipped", { reason: "gate" });
          }
        } catch (error) {
          // The error of one mailbox does not stop the next.
          total.mailboxErrors += 1;
          mailboxLog.error("chaser_failed", { ...errorFields(error) });
        }
      }
      return total;
    },
  };
}

function skipped(): LoopChaserResult {
  return { skipped: null, due: 0, overdue: 0, reminders: 0, followUps: 0, stale: 0, expired: 0 };
}
