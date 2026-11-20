import { mailOAuthRuntime } from "../composition";
import type { TelegramRuntime } from "../modules/channels";
import type { Config } from "../platform/config";
import { createSecretBox, type SecretBox } from "../platform/crypto";
import type { Db } from "../platform/db";
import type { Log } from "../platform/log";
import { createScheduler, type Scheduler } from "../platform/scheduler";

import { createRunTracker, type RunTracker } from "./runs";

// What every start function reads. `main.ts` builds it once; a start function returns what a later start needs.
export interface StartContext {
  config: Config;
  db: Db;
  log: Log;
  scheduler: Scheduler;
  // The newest run of each job that shutdown waits for.
  runs: RunTracker;
  startedAt: Date;
  secrets: SecretBox;
  mailOAuth: ReturnType<typeof mailOAuthRuntime>;
  // Set after the first read: `startTelegram` sets `telegram`; the operator send and the shutdown steps read it when they run.
  late: { telegram: TelegramRuntime | null };
}

export function createStartContext(deps: { config: Config; db: Db; log: Log; startedAt: Date }): StartContext {
  const secrets = createSecretBox(deps.config.CREDENTIALS_KEY, deps.config.CREDENTIALS_KEY_VERSION);
  return {
    ...deps,
    scheduler: createScheduler(),
    runs: createRunTracker(),
    secrets,
    mailOAuth: mailOAuthRuntime(deps.config, deps.db, secrets),
    late: { telegram: null },
  };
}
