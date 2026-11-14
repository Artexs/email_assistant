import { randomUUID } from "node:crypto";

import { Cron } from "croner";

import { withoutTenantScope } from "./db/tenant-scope";
import { errorFields } from "./errors";
import { createLog, withLogContext } from "./log";

const log = createLog("scheduler");

export interface Scheduler {
  add(name: string, pattern: string, fn: () => Promise<void>): void;
  stop(): void;
}

/** One tick of a job in its own log context, with no tenant scope (RLS safety net). Never throws: a failure is one job_failed line. */
export async function runJobTick(name: string, fn: () => Promise<void>): Promise<void> {
  const start = performance.now();
  await withoutTenantScope(() =>
    withLogContext({ job: name, run_id: randomUUID() }, async () => {
      try {
        await fn();
        log.debug("job_done", { ms: Math.round(performance.now() - start) });
      } catch (error) {
        log.error("job_failed", { ms: Math.round(performance.now() - start), ...errorFields(error) });
      }
    })
  );
}

/** Runs jobs in this process. One job never runs twice at the same time: a tick that finds the job still running is skipped. */
export function createScheduler(): Scheduler {
  const jobs: Cron[] = [];

  return {
    add(name, pattern, fn) {
      jobs.push(
        new Cron(
          pattern,
          {
            protect: () => log.debug("job_skipped", { job: name }),
            // A last guard: runJobTick catches every failure itself.
            catch: (error) => log.error("job_failed", { job: name, ...errorFields(error) }),
          },
          () => runJobTick(name, fn)
        )
      );
    },
    stop() {
      for (const job of jobs) job.stop();
      jobs.length = 0;
    },
  };
}
