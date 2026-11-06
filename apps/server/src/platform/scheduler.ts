import { Cron } from "croner";

import { describeError } from "./errors";
import { createLog } from "./log";

const log = createLog("scheduler");

export interface Scheduler {
  add(name: string, pattern: string, fn: () => Promise<void>): void;
  stop(): void;
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
            protect: () => log.debug(`${name} skipped: the previous run is still going`),
            catch: (error) => log.error(`${name} failed: ${describeError(error)}`),
          },
          fn
        )
      );
    },
    stop() {
      for (const job of jobs) job.stop();
      jobs.length = 0;
    },
  };
}
