import { actionsScope, committerDeps, sendScope, uidplusOf } from "./composition";
import { createCommitterJob, createExpiryJob, isOwnActionId } from "./modules/actions";
import { createOperatorNotices, createTelegramRuntime } from "./modules/channels";
import { createChaserJob, delegationHooks } from "./modules/delegation";
import { configureMailHosts, countSyncTargets, createMailSyncJob, openImapProvider } from "./modules/mail";
import { configureFeatures, listOrganizations } from "./modules/tenancy";
import { createLlmPause, createReturnedJob, createTriageJob, type TriageScope } from "./modules/triage";
import {
  ConfigError,
  featuresOff,
  llmRoleTable,
  loadConfig,
  mailAllowLocal,
  operatorChatId,
  sendLimits,
  testMailRule,
  type Config,
} from "./platform/config";
import { createSecretBox } from "./platform/crypto";
import { assertAppRole, checkDb, createDb } from "./platform/db";
import { errorFields } from "./platform/errors";
import { createHeartbeat } from "./platform/heartbeat";
import { createApp } from "./platform/http";
import { createLlmClient, llmProviders, type LlmProviderId } from "./platform/llm";
import { createLog, setLogFormat, setLogLevel } from "./platform/log";
import { createScheduler } from "./platform/scheduler";
import { createRetentionJob } from "./retention";
import { webDeps } from "./web";

const log = createLog("main");
const startedAt = new Date();

function loadConfigOrExit() {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      for (const key of error.keys) log.error("config_key_bad", { config_key: key });
    } else {
      log.error("config_load_failed", { ...errorFields(error) });
    }
    process.exit(1);
  }
}

// null: the worker is off.
function triageScope(config: Config, provider: LlmProviderId): TriageScope | null {
  if (config.TRIAGE_LLM_SCOPE === "off") {
    log.info("triage_scope", { scope: "off" });
    return null;
  }
  if (config.TRIAGE_LLM_SCOPE === "synthetic") {
    log.info("triage_scope", { scope: "synthetic" });
    return { kind: "synthetic", testMail: testMailRule(config) };
  }
  log.warn("triage_scope", { scope: "all", provider });
  return { kind: "all" };
}

const config = loadConfigOrExit();
setLogLevel(config.LOG_LEVEL);
setLogFormat(config.LOG_FORMAT);
configureMailHosts({ allowLocal: mailAllowLocal(config) });
const featuresOffList = featuresOff(config);
configureFeatures({ off: featuresOffList });
log.info("features_off", { count: featuresOffList.length });
for (const flag of featuresOffList) log.info("feature_killed", { flag });
if (config.MAIL_ALLOW_LOCAL_HOSTS === undefined && config.WEB_MAIL_ALLOW_LOCAL !== undefined) {
  log.warn("config_key_renamed", { config_key: "WEB_MAIL_ALLOW_LOCAL" });
}
if (mailAllowLocal(config)) log.warn("mail_local_hosts_allowed");

const db = createDb(config.DATABASE_URL);
try {
  await assertAppRole(db);
} catch (error) {
  log.error("db_role_check_failed", { ...errorFields(error) });
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
if (config.HEARTBEAT_URL === undefined) log.warn("heartbeat_off");
if (config.WEB_BASE_URL !== undefined && config.OPERATOR_CONTACT === undefined) {
  log.warn("operator_contact_empty");
}

const scheduler = createScheduler();
scheduler.add("mail.sync", "*/5 * * * *", mailSync.run);
scheduler.add("platform.heartbeat", "*/5 * * * *", heartbeat.tick);

// A3: when a scope is `all`, one start line says whom the jobs act on (counts only, no ids). A DB error does not stop the start.
if (config.TRIAGE_LLM_SCOPE === "all" || config.ACTIONS_SCOPE === "all" || config.SEND_SCOPE === "all") {
  try {
    const targets = await countSyncTargets(db);
    const suspended = (await listOrganizations(db)).filter((org) => org.plan === "suspended").length;
    log.warn("scope_targets", {
      mailbox_count: targets.mailboxes,
      org_count: targets.organizations,
      suspended_count: suspended,
    });
  } catch (error) {
    log.warn("scope_targets_failed", { ...errorFields(error) });
  }
}

// The Telegram runtime; set below when TELEGRAM_BOT_TOKEN is set. The operator notices read it at call time.
let telegram: ReturnType<typeof createTelegramRuntime> | null = null;

// Operator notices (D31): the chat id is private data and never reaches a log line.
const operatorChat = operatorChatId(config);
const operator = createOperatorNotices({
  db,
  now: () => new Date(),
  send:
    operatorChat === null
      ? null
      : async (text) => {
          if (telegram === null) throw new Error("telegram is off");
          await telegram.sendDirect(operatorChat, text);
        },
});
let operatorRun: Promise<void> = Promise.resolve();
scheduler.add("channels.operator", "0 13 * * * *", () => {
  operatorRun = operator.run();
  return operatorRun;
});
log.info("operator_notices_on", { kind: operatorChat === null ? "log" : "telegram" });

// The run of the triage worker that is going now. Shutdown waits for it.
let triageRun: Promise<void> = Promise.resolve();
const llmTable = llmRoleTable(config);
const classifierRow = llmTable.roles.classifier;
const provider = llmProviders[classifierRow.provider];
const scope = triageScope(config, classifierRow.provider);
if (scope !== null) {
  log.info("llm_settings", { provider: classifierRow.provider, model: classifierRow.model });
  const llm = createLlmClient({ table: llmTable });
  const triage = createTriageJob({
    db,
    llm,
    pause: createLlmPause({ configHint: provider.configHint }),
    scope,
    testMail: testMailRule(config),
    batchSize: 5,
    dailyCap: config.LLM_DAILY_CAP,
    now: () => new Date(),
    onCapReached: (ctx, mailboxId, dayStart) => operator.capReached(ctx, mailboxId, dayStart, config.LLM_DAILY_CAP),
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
const limitsOfSends = sendLimits(config);
log.info("send_limits", {
  mailbox_hour: limitsOfSends.mailboxHour,
  mailbox_day: limitsOfSends.mailboxDay,
  recipient_day: limitsOfSends.recipientDay,
});
const hooks = delegationHooks({ db });
const uidplus = uidplusOf(db);
// Always built: `save_summary` rows are applied under every scope.
const committer = createCommitterJob(
  committerDeps({
    db,
    secrets,
    scope: scopeOfActions,
    sendScope: scopeOfSends,
    sendLimits: limitsOfSends,
    onSendLimited: (ctx, hit) => operator.sendLimitReached(ctx, hit),
  })
);
scheduler.add("actions.committer", "*/15 * * * * *", () => {
  committerRun = committer.run();
  return committerRun;
});
const expiry = createExpiryJob({ db, now: () => new Date(), hooks, uidplus });
scheduler.add("actions.expiry", "0 7 * * * *", () => {
  expiryRun = expiry.run();
  return expiryRun;
});
log.info("job_scheduled", { job: "actions.expiry" });
const chaser = createChaserJob({ db, now: () => new Date() });
scheduler.add("delegation.chaser", "20 */15 * * * *", () => {
  chaserRun = chaser.run();
  return chaserRun;
});
log.info("job_scheduled", { job: "delegation.chaser" });
const returned = createReturnedJob({ db, now: () => new Date() });
scheduler.add("triage.returned", "*/15 * * * * *", () => {
  returnedRun = returned.run();
  return returnedRun;
});

// The daily retention run (A23). Shutdown waits for it.
let retentionRun: Promise<void> = Promise.resolve();
const retention = createRetentionJob({ db, now: () => new Date() });
scheduler.add("platform.retention", "0 40 2 * * *", () => {
  retentionRun = retention.run();
  return retentionRun;
});
log.info("job_scheduled", { job: "platform.retention" });

// The runs of the notifier and the digest job that are going now. Shutdown waits for them.
let channelRun: Promise<void> = Promise.resolve();
let digestRun: Promise<void> = Promise.resolve();
if (config.TELEGRAM_BOT_TOKEN === undefined) {
  log.info("telegram_off");
} else {
  if (config.TELEGRAM_API_ROOT !== undefined) {
    log.warn("telegram_api_root_set");
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
    llm: { provider: classifierRow.provider, classifierModel: classifierRow.model },
    hooks,
    uidplus,
    sendScope: scopeOfSends,
    testMail: testMailRule(config),
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
  onAuthMailFailed: (ctx, userId, kind, code) => operator.authMailFailed(ctx, userId, kind, code, new Date()),
});
const app = createApp({ checkDb: () => checkDb(db), web });
// idleTimeout: the connect route runs a mailbox login inside the request; Bun's default is 10 s.
const server = Bun.serve({ port: config.PORT, idleTimeout: 90, fetch: app.fetch });

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
    Promise.allSettled([
      triageRun,
      committerRun,
      returnedRun,
      expiryRun,
      chaserRun,
      channelRun,
      digestRun,
      operatorRun,
      retentionRun,
    ]),
    sleep(SHUTDOWN_WAIT_MS),
  ]);
  await server.stop();
  await web?.close();
  await db.destroy();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

// After the handlers: this line says the server is ready. A SIGTERM before the handlers exist would kill the process with exit 143 (F123).
log.info("server_listening", { port: server.port });
