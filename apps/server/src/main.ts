import { createTelegramRuntime } from "./modules/channels";
import { createMailSyncJob, openImapProvider } from "./modules/mail";
import { createLlmPause, createTriageJob, type TriageScope } from "./modules/triage";
import { classifierModel, ConfigError, loadConfig, type Config } from "./platform/config";
import { createSecretBox } from "./platform/crypto";
import { assertAppRole, checkDb, createDb } from "./platform/db";
import { createHeartbeat } from "./platform/heartbeat";
import { createApp } from "./platform/http";
import { createLlmClient } from "./platform/llm";
import { createLog, setLogLevel } from "./platform/log";
import { createScheduler } from "./platform/scheduler";

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

// null: the worker is off. The config check guarantees the keys that the other scopes need.
function triageScope(config: Config): TriageScope | null {
  if (config.TRIAGE_LLM_SCOPE === "off") {
    log.info("triage worker is off (TRIAGE_LLM_SCOPE=off)");
    return null;
  }
  if (config.TRIAGE_LLM_SCOPE === "synthetic") {
    log.info("triage takes only synthetic mail (TRIAGE_LLM_SCOPE=synthetic)");
    return { kind: "synthetic" };
  }
  log.warn("triage sends the real mail of the TEST_MAILBOX_ADDRESS mailbox to Gemini (TRIAGE_LLM_SCOPE=all)");
  return { kind: "all", mailboxAddress: config.TEST_MAILBOX_ADDRESS ?? "" };
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

const app = createApp({ checkDb: () => checkDb(db) });
const server = Bun.serve({ port: config.PORT, fetch: app.fetch });
log.info(`listening on port ${server.port}`);

const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
const mailSync = createMailSyncJob({
  db,
  secrets,
  openProvider: openImapProvider,
  // The actions table comes in S1b; until then no mail is the system's own.
  isOwnActionId: async () => false,
  now: () => new Date(),
});
const heartbeat = createHeartbeat({ url: config.HEARTBEAT_URL, checkDb: () => checkDb(db) });
if (config.HEARTBEAT_URL === undefined) log.warn("HEARTBEAT_URL is not set: the heartbeat is off");

const scheduler = createScheduler();
scheduler.add("mail.sync", "*/5 * * * *", mailSync.run);
scheduler.add("platform.heartbeat", "*/5 * * * *", heartbeat.tick);

// The run of the triage worker that is going now. Shutdown waits for it.
let triageRun: Promise<void> = Promise.resolve();
const scope = triageScope(config);
if (scope !== null) {
  const llm = createLlmClient({
    provider: "gemini",
    apiKey: config.GEMINI_API_KEY ?? "",
    classifierModel: classifierModel(config),
    timeoutMs: config.GEMINI_TIMEOUT_MS,
    rpm: config.GEMINI_RPM,
  });
  const triage = createTriageJob({
    db,
    llm,
    pause: createLlmPause(),
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

// The runs of the notifier and the digest job that are going now. Shutdown waits for them.
let channelRun: Promise<void> = Promise.resolve();
let digestRun: Promise<void> = Promise.resolve();
let telegram: ReturnType<typeof createTelegramRuntime> | null = null;
if (config.TELEGRAM_BOT_TOKEN === undefined) {
  log.info("telegram is off (TELEGRAM_BOT_TOKEN is empty)");
} else {
  const runtime = createTelegramRuntime({
    db,
    token: config.TELEGRAM_BOT_TOKEN,
    now: () => new Date(),
    startedAt,
    llmDailyCap: config.LLM_DAILY_CAP,
    triageScope: config.TRIAGE_LLM_SCOPE,
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
  await Promise.race([Promise.allSettled([triageRun, channelRun, digestRun]), sleep(SHUTDOWN_WAIT_MS)]);
  await server.stop();
  await db.destroy();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
