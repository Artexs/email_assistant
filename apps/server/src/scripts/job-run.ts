import { actionsScope, committerDeps, sendScope, uidplusOf } from "../composition";
import { createCommitterJob, createExpiryJob } from "../modules/actions";
import { createTelegramRuntime } from "../modules/channels";
import { createChaserJob, delegationHooks } from "../modules/delegation";
import { llmSettings, loadConfig } from "../platform/config";
import { createSecretBox } from "../platform/crypto";
import { assertAppRole, createDb } from "../platform/db";
import { describeError } from "../platform/errors";
import { createLog } from "../platform/log";
import { createRetentionJob } from "../retention";

import { parseJobRunArgs, usage } from "./job-run-args";

const log = createLog("job-run");

// Runs one job once with the deps of `main.ts`. For dev and ops checks; it logs ids and counts only, like the server.
async function main(): Promise<number> {
  const args = parseJobRunArgs(process.argv.slice(2));
  if (args === null) {
    log.error(usage);
    return 1;
  }
  const config = loadConfig();
  if (args.name === "channels.notifier" && config.TELEGRAM_BOT_TOKEN === undefined) {
    log.error("TELEGRAM_BOT_TOKEN is empty");
    return 1;
  }
  const db = createDb(config.DATABASE_URL);
  try {
    await assertAppRole(db);
    const now = () => new Date();
    const hooks = delegationHooks({ db });
    const uidplus = uidplusOf(db);
    if (args.name === "actions.expiry") {
      await createExpiryJob({ db, now, hooks, uidplus }).run();
    } else if (args.name === "delegation.chaser") {
      await createChaserJob({ db, now }).run({ force: args.force });
    } else if (args.name === "actions.committer") {
      log.warn("do not run the committer here while the server runs on the same database: the log lines double");
      const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
      await createCommitterJob(
        committerDeps({ db, secrets, scope: actionsScope(config), sendScope: sendScope(config) })
      ).run();
    } else if (args.name === "platform.retention") {
      await createRetentionJob({ db, now }).run();
    } else {
      const settings = llmSettings(config);
      const runtime = createTelegramRuntime({
        db,
        token: config.TELEGRAM_BOT_TOKEN ?? "",
        apiRoot: config.TELEGRAM_API_ROOT,
        now,
        startedAt: now(),
        llmDailyCap: config.LLM_DAILY_CAP,
        triageScope: config.TRIAGE_LLM_SCOPE,
        actionsScope: actionsScope(config),
        llm: { provider: settings.provider, classifierModel: settings.classifierModel },
        hooks,
        uidplus,
        sendScope: sendScope(config),
        operatorContact: null,
      });
      await runtime.notify();
    }
    log.info(`${args.name}: ran once`);
    return 0;
  } catch (error) {
    log.error(`${args.name} failed: ${describeError(error)}`);
    return 1;
  } finally {
    await db.destroy().catch(() => undefined);
  }
}

process.exit(await main());
