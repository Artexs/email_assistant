import { errorFields } from "../../platform/errors";
import { createLog } from "../../platform/log";
import { listSyncTargets } from "../mail";
import { isOrgSuspended } from "../tenancy";
import { createLlmPause } from "../triage";

import { type AnalyzeDeps, analyzeSent, DEFAULT_LIMIT, emptyResult, type AnalyzeResult } from "./analyze";

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

// The jobs of the module `loops`. Later stages add the reply match and the chaser.
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
