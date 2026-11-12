import { actionsScope, committerDeps, sendScope, uidplusOf } from "./composition";
import { createCommitterJob, createExpiryJob, isOwnActionId } from "./modules/actions";
import { createTelegramRuntime } from "./modules/channels";
import { createChaserJob, delegationHooks } from "./modules/delegation";
import { countSyncTargets, createMailSyncJob, openImapProvider } from "./modules/mail";
import { listOrganizations } from "./modules/tenancy";
import { createLlmPause, createReturnedJob, createTriageJob, type TriageScope } from "./modules/triage";
import { ConfigError, llmSettings, loadConfig, type Config } from "./platform/config";
import { createSecretBox } from "./platform/crypto";
import { assertAppRole, checkDb, createDb } from "./platform/db";
import { describeError } from "./platform/errors";
import { createHeartbeat } from "./platform/heartbeat";
import { createApp } from "./platform/http";
import { createLlmClient, llmProviders } from "./platform/llm";
import { createLog, setLogLevel } from "./platform/log";
import { createScheduler } from "./platform/scheduler";
import { webDeps } from "./web";

const log = createLog("main");
const startedAt = new Date();

function loadConfigOrExit() {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      log.error(`config error: missing or bad keys: ${error.keys.join(", ")}`);
    } else {
      log.error("config error:", error instanceof Error ? error.message : error);
    }
    process.exit(1);
  }
}

// null: the worker is off.
function triageScope(config: Config, providerLabel: string): TriageScope | null {
  if (config.TRIAGE_LLM_SCOPE === "off") {
    log.info("triage worker is off (TRIAGE_LLM_SCOPE=off)");
    return null;
  }
  if (config.TRIAGE_LLM_SCOPE === "synthetic") {
    log.info("triage takes only synthetic mail (TRIAGE_LLM_SCOPE=synthetic)");
    return { kind: "synthetic" };
  }
  log.warn(`triage sends the real mail of every active mailbox to ${providerLabel} (TRIAGE_LLM_SCOPE=all)`);
  return { kind: "all" };
}

const config = loadConfigOrExit();
setLogLevel(config.LOG_LEVEL);

const db = createDb(config.DATABASE_URL);
try {
  await assertAppRole(db);
} catch (error) {
  log.error("db role check failed:", error instanceof Error ? error.message : error);
  await db.destroy().catch(() => undefined);
  process.exit(1);
}

const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
const mailSync = createMailSyncJob({
  db,
  secrets,
  openProvider: openImapProvider,
  isOwnActionId: (ctx, mailboxId, actionId) => isOwnActionId(db, ctx, mailboxId, actionId),
  now: () => new Date(),
});
const heartbeat = createHeartbeat({ url: config.HEARTBEAT_URL, checkDb: () => checkDb(db) });
if (config.HEARTBEAT_URL === undefined) log.warn("HEARTBEAT_URL is not set: the heartbeat is off");
if (config.WEB_BASE_URL !== undefined && config.OPERATOR_CONTACT === undefined) {
  log.warn("OPERATOR_CONTACT is empty: the paused banner names no contact");
}

const scheduler = createScheduler();
scheduler.add("mail.sync", "*/5 * * * *", mailSync.run);
scheduler.add("platform.heartbeat", "*/5 * * * *", heartbeat.tick);

// A3: when a scope is `all`, one start line says whom the jobs act on (counts only, no ids). A DB error does not stop the start.
if (config.TRIAGE_LLM_SCOPE === "all" || config.ACTIONS_SCOPE === "all" || config.SEND_SCOPE === "all") {
  try {
    const targets = await countSyncTargets(db);
    const suspended = (await listOrganizations(db)).filter((org) => org.plan === "suspended").length;
    log.warn(
      `scope targets: ${targets.mailboxes} active mailboxes in ${targets.organizations} organizations, ${suspended} suspended organizations`
    );
  } catch (error) {
    log.warn(`scope targets: count failed (${describeError(error)})`);
  }
}

// The run of the triage worker that is going now. Shutdown waits for it.
let triageRun: Promise<void> = Promise.resolve();
const settings = llmSettings(config);
const provider = llmProviders[settings.provider];
const scope = triageScope(config, provider.label);
if (scope !== null) {
  log.info(`llm provider=${settings.provider} classifier=${settings.classifierModel}`);
  const llm = createLlmClient({
    provider: settings.provider,
    apiKey: settings.apiKey ?? "",
    classifierModel: settings.classifierModel,
    timeoutMs: settings.timeoutMs,
    rpm: settings.rpm,
    reasoningEffort: settings.reasoningEffort,
  });
  const triage = createTriageJob({
    db,
    llm,
    pause: createLlmPause({ configHint: provider.configHint }),
    scope,
    batchSize: 5,
    dailyCap: config.LLM_DAILY_CAP,
    now: () => new Date(),
  });
  scheduler.add("triage.worker", "*/15 * * * * *", () => {
    triageRun = triage.run();
    return triageRun;
  });
}

// The runs of the committer, the returned job and the S4 jobs that are going now. Shutdown waits for them.
let committerRun: Promise<void> = Promise.resolve();
let returnedRun: Promise<void> = Promise.resolve();
let expiryRun: Promise<void> = Promise.resolve();
let chaserRun: Promise<void> = Promise.resolve();
const scopeOfActions = actionsScope(config);
const scopeOfSends = sendScope(config);
const hooks = delegationHooks({ db });
const uidplus = uidplusOf(db);
// Always built: `save_summary` rows are applied under every scope.
const committer = createCommitterJob(committerDeps({ db, secrets, scope: scopeOfActions, sendScope: scopeOfSends }));
scheduler.add("actions.committer", "*/15 * * * * *", () => {
  committerRun = committer.run();
  return committerRun;
});
const expiry = createExpiryJob({ db, now: () => new Date(), hooks, uidplus });
scheduler.add("actions.expiry", "0 7 * * * *", () => {
  expiryRun = expiry.run();
  return expiryRun;
});
log.info("actions expiry: hourly");
const chaser = createChaserJob({ db, now: () => new Date() });
scheduler.add("delegation.chaser", "20 */15 * * * *", () => {
  chaserRun = chaser.run();
  return chaserRun;
});
log.info("delegation chaser: every 15 min (acts at 07:30 local)");
const returned = createReturnedJob({ db, now: () => new Date() });
scheduler.add("triage.returned", "*/15 * * * * *", () => {
  returnedRun = returned.run();
  return returnedRun;
});

// The runs of the notifier and the digest job that are going now. Shutdown waits for them.
let channelRun: Promise<void> = Promise.resolve();
let digestRun: Promise<void> = Promise.resolve();
let telegram: ReturnType<typeof createTelegramRuntime> | null = null;
if (config.TELEGRAM_BOT_TOKEN === undefined) {
  log.info("telegram is off (TELEGRAM_BOT_TOKEN is empty)");
} else {
  if (config.TELEGRAM_API_ROOT !== undefined) {
    log.warn(
      `telegram: TELEGRAM_API_ROOT is set: the bot talks to the Bot API at ${config.TELEGRAM_API_ROOT}, not to Telegram`
    );
  }
  const runtime = createTelegramRuntime({
    db,
    token: config.TELEGRAM_BOT_TOKEN,
    apiRoot: config.TELEGRAM_API_ROOT,
    now: () => new Date(),
    startedAt,
    llmDailyCap: config.LLM_DAILY_CAP,
    triageScope: config.TRIAGE_LLM_SCOPE,
    actionsScope: scopeOfActions,
    llm: { provider: settings.provider, classifierModel: settings.classifierModel },
    hooks,
    uidplus,
    sendScope: scopeOfSends,
    operatorContact: config.OPERATOR_CONTACT ?? null,
  });
  telegram = runtime;
  scheduler.add("channels.notifier", "*/15 * * * * *", () => {
    channelRun = runtime.notify();
    return channelRun;
  });
  scheduler.add("channels.digest", "5 * * * * *", () => {
    digestRun = runtime.scheduleDigests();
    return digestRun;
  });
  runtime.startPolling();
}
void heartbeat.tick();

const web = webDeps(config, db, {
  secrets,
  actionsScope: scopeOfActions,
  botUsername: telegram ? () => telegram.botUsername() : null,
});
const app = createApp({ checkDb: () => checkDb(db), web });
// idleTimeout: the connect route runs a mailbox login inside the request; Bun's default is 10 s.
const server = Bun.serve({ port: config.PORT, idleTimeout: 90, fetch: app.fetch });
log.info(`listening on port ${server.port}`);

const SHUTDOWN_WAIT_MS = 30_000;
// bot.stop() can wait for the network.
const TELEGRAM_STOP_WAIT_MS = 10_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let stopping = false;

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  scheduler.stop();
  // Together with the wait below the sum stays under stop_grace_period (45 s).
  if (telegram !== null) {
    await Promise.race([telegram.stop().catch(() => undefined), sleep(TELEGRAM_STOP_WAIT_MS)]);
  }
  // A kill in the middle of a batch makes the next start count an attempt for each claimed mail. Wait for the batch, but not for ever.
  await Promise.race([
    Promise.allSettled([triageRun, committerRun, returnedRun, expiryRun, chaserRun, channelRun, digestRun]),
    sleep(SHUTDOWN_WAIT_MS),
  ]);
  await server.stop();
  await web?.close();
  await db.destroy();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
