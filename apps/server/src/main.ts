import { readFile, statfs } from "node:fs/promises";

import {
  actionsScope,
  committerDeps,
  gateEvidenceOf,
  mailOAuthRuntime,
  sendScope,
  settingsDeps,
  uidplusOf,
} from "./composition";
import { createCommitterJob, createExpiryJob, isOwnActionId, sentOriginOf } from "./modules/actions";
import { createOperatorNotices, createTelegramRuntime } from "./modules/channels";
import { delegationHooks } from "./modules/delegation";
import { createLoopChaserJob, createLoopJobs, createLoopMatchJob } from "./modules/loops";
import { configureMailHosts, countSyncTargets, createMailSyncJob, openImapProvider } from "./modules/mail";
import {
  checkBackupAge,
  checkDisk,
  checkLlmErrors,
  checkSyncLag,
  checkUrgentLatency,
  runSloTick,
  type SloCheckEntry,
} from "./modules/operator";
import { configureFeatures, countSsoRequiredWhileKilled, listOrganizations } from "./modules/tenancy";
import { createLlmPause, createReturnedJob, createTriageJob, type LlmPause, type TriageScope } from "./modules/triage";
import { createHistoryJob, regateAll, type RegateDeps } from "./modules/trust";
import {
  ConfigError,
  featuresOff,
  llmRoleTable,
  loadConfig,
  mailAllowLocal,
  mailSyncCron,
  operatorChatId,
  sendLimits,
  sloThresholds,
  mailTrustedAuthservIds,
  testMailRule,
  type Config,
} from "./platform/config";
import { createSecretBox } from "./platform/crypto";
import { assertAppRole, checkDb, createDb } from "./platform/db";
import { errorFields } from "./platform/errors";
import { createHeartbeat } from "./platform/heartbeat";
import { createApp } from "./platform/http";
import { createLlmClient, llmEndpointFields, type LlmProviderId } from "./platform/llm";
import { createLog, installConsoleGuard, setLogFormat, setLogLevel, setLogRelease } from "./platform/log";
import { installProcessGuard } from "./platform/process-guard";
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
setLogRelease(config.EA_RELEASE);
// JSON format (production): text from a library never reaches the log. Text format (dev) keeps the console.
if (config.LOG_FORMAT === "json") installConsoleGuard();
installProcessGuard(log);
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

// F119 N12: a killed `sso_sign_in` locks out every member of an organization that requires SSO, except its break-glass owner.
// A DB error does not stop the start.
try {
  const lockedOut = await countSsoRequiredWhileKilled(db);
  if (lockedOut > 0) log.warn("sso_flag_killed_with_sso_required", { count: lockedOut });
} catch (error) {
  log.warn("sso_flag_check_failed", { ...errorFields(error) });
}

const secrets = createSecretBox(config.CREDENTIALS_KEY, config.CREDENTIALS_KEY_VERSION);
const mailOAuth = mailOAuthRuntime(config, db, secrets);
const mailSync = createMailSyncJob({
  db,
  secrets,
  openProvider: openImapProvider,
  oauthTokens: mailOAuth.tokens,
  isOwnActionId: (ctx, mailboxId, actionId) => isOwnActionId(db, ctx, mailboxId, actionId),
  sentOriginOf: (ctx, mailboxId, actionId) => sentOriginOf(db, ctx, mailboxId, actionId),
  now: () => new Date(),
});
const heartbeat = createHeartbeat({ url: config.HEARTBEAT_URL, checkDb: () => checkDb(db) });
if (config.HEARTBEAT_URL === undefined) log.warn("heartbeat_off");
if (config.WEB_BASE_URL !== undefined && config.OPERATOR_CONTACT === undefined) {
  log.warn("operator_contact_empty");
}

const scheduler = createScheduler();
scheduler.add("mail.sync", mailSyncCron(config), mailSync.run);
log.info("mail_sync_interval", { minutes: Number(config.MAIL_SYNC_EVERY_MIN) });
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
const operatorSend =
  operatorChat === null
    ? null
    : async (text: string): Promise<void> => {
        if (telegram === null) throw new Error("telegram is off");
        await telegram.sendDirect(operatorChat, text);
      };
const operator = createOperatorNotices({ db, now: () => new Date(), send: operatorSend });
let operatorRun: Promise<void> = Promise.resolve();
scheduler.add("channels.operator", "0 13 * * * *", () => {
  operatorRun = operator.run();
  return operatorRun;
});
log.info("operator_notices_on", { kind: operatorChat === null ? "log" : "telegram" });

// F114: the service-level alerts. The job runs in every case: with no operator chat the `slo_alert_sent` line is the send.
// The alert goes only to the operator chat, through the same send as the operator notices. The scheduler runs the tick
// with no tenant scope, because the checks read every organization.
const slo = sloThresholds(config);
const sloChecks: SloCheckEntry[] = [
  { kind: "slo_sync_lag", run: (now) => checkSyncLag(db, now, slo, startedAt) },
  {
    kind: "slo_urgent_latency",
    run: (now) => checkUrgentLatency(db, now, slo, startedAt, testMailRule(config)),
  },
  { kind: "slo_llm_errors", run: (now) => checkLlmErrors(db, now, slo) },
  { kind: "slo_disk", run: () => checkDisk(statfs, slo) },
  // null when BACKUP_STATUS_FILE is empty: the check is off and an open alert of this kind stays as it is.
  { kind: "slo_backup_age", run: (now) => checkBackupAge((path) => readFile(path, "utf8"), now, slo) },
];
let sloRun: Promise<void> = Promise.resolve();
scheduler.add("ops.slo", "30 */5 * * * *", () => {
  sloRun = runSloTick(
    { db, checks: sloChecks, send: operatorSend, cfg: slo, log, locale: config.OPERATOR_LOCALE },
    new Date()
  );
  return sloRun;
});

// The run of the triage worker that is going now. Shutdown waits for it.
let triageRun: Promise<void> = Promise.resolve();
let loopsAnalyzeRun: Promise<void> = Promise.resolve();
let historyRun: Promise<void> = Promise.resolve();
let loopsMatchRun: Promise<void> = Promise.resolve();
// One pause object for the triage worker and the `not_triaged` notice job: they run in this process (F109 stage 15).
let degraded: { pause: LlmPause; scope: TriageScope } | undefined;
const llmTable = llmRoleTable(config);
const classifierRow = llmTable.roles.classifier;
// The global evidence of this classifier: the gate files are read once here and passed to the settings deps (F110 D1).
const gate = gateEvidenceOf(config, { table: llmTable });
const scope = triageScope(config, classifierRow.provider);
// The re-gate of `auto` (F110 stage 08, rule 16): it runs once here, before the triage worker and the committer exist, so a `ready` move that
// was planned under the old model meets the new policy. A failure of the whole run (the database) stops the start: the container restarts.
// A mailbox that fails alone is logged and left to the job below. It always runs: the global evidence belongs to the model, not to a flag.
const regateDeps: Omit<RegateDeps, "run"> = {
  db,
  gate,
  testMail: testMailRule(config),
  settingsOf: (trx) => settingsDeps(trx, () => new Date(), gate),
  ...(config.WEB_BASE_URL === undefined ? {} : { webBaseUrl: config.WEB_BASE_URL }),
};
try {
  await regateAll({ ...regateDeps, run: "start" }, new Date());
} catch (error) {
  log.error("trust_regate_failed", { ...errorFields(error) });
  await db.destroy().catch(() => undefined);
  process.exit(1);
}
let regateRun: Promise<void> = Promise.resolve();
scheduler.add("trust.regate", "20 */5 * * * *", () => {
  regateRun = regateAll({ ...regateDeps, run: "job" }, new Date()).then(() => undefined);
  return regateRun;
});
log.info("job_scheduled", { job: "trust.regate" });
if (scope !== null) {
  log.info("llm_settings", { ...llmEndpointFields(llmTable, "classifier") });
  const llm = createLlmClient({ table: llmTable });
  const pause = createLlmPause();
  degraded = { pause, scope };
  const triage = createTriageJob({
    db,
    llm,
    pause,
    scope,
    testMail: testMailRule(config),
    batchSize: 5,
    dailyCap: config.LLM_DAILY_CAP,
    runningKey: gate.runningKey,
    trustedAuthservIds: mailTrustedAuthservIds(config),
    now: () => new Date(),
    onCapReached: (ctx, mailboxId, dayStart) => operator.capReached(ctx, mailboxId, dayStart, config.LLM_DAILY_CAP),
  });
  scheduler.add("triage.worker", "*/15 * * * * *", () => {
    triageRun = triage.run();
    return triageRun;
  });
  // The history check of the trust ladder (F110): it reads mail, classifies a sample with the model client and the pause of the triage worker, and writes the checks.
  const history = createHistoryJob({
    db,
    secrets,
    openProvider: openImapProvider,
    oauthTokens: mailOAuth.tokens,
    isOwnActionId: (ctx, mailboxId, actionId) => isOwnActionId(db, ctx, mailboxId, actionId),
    runningKey: gate.runningKey,
    gateIndex: gate.index,
    llm,
    pause,
    scope,
    testMail: testMailRule(config),
    trustedAuthservIds: mailTrustedAuthservIds(config),
    ...(config.WEB_BASE_URL === undefined ? {} : { webBaseUrl: config.WEB_BASE_URL }),
    now: () => new Date(),
  });
  scheduler.add("trust.history", "*/15 * * * * *", () => {
    historyRun = history.run();
    return historyRun;
  });
  log.info("job_scheduled", { job: "trust.history" });
  // The Sent analysis of the open loops uses the same model client and the same scope: with the scope off, no mail goes out.
  const loopJobs = createLoopJobs({ db, llm, dailyCap: config.LLM_DAILY_CAP, scope, now: () => new Date() });
  scheduler.add("loops.analyze", "35 * * * * *", () => {
    loopsAnalyzeRun = loopJobs.analyze.run().then(() => undefined);
    return loopsAnalyzeRun;
  });
  log.info("job_scheduled", { job: "loops.analyze" });
}
// The close rules need no model: they run with the scope off too, so a reply still closes its loop.
const loopMatch = createLoopMatchJob({ db, now: () => new Date() });
scheduler.add("loops.match", "50 */2 * * * *", () => {
  loopsMatchRun = loopMatch.run().then(() => undefined);
  return loopsMatchRun;
});
log.info("job_scheduled", { job: "loops.match" });

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
    oauthTokens: mailOAuth.tokens,
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
// The one chaser (delegation reminders, loop follow-ups, stale and expired loops). It replaces `delegation.chaser`.
const chaser = createLoopChaserJob({ db, now: () => new Date() });
scheduler.add("loops.chaser", "20 */15 * * * *", () => {
  chaserRun = chaser.run().then(() => undefined);
  return chaserRun;
});
log.info("job_scheduled", { job: "loops.chaser" });
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
    ...(degraded === undefined ? {} : { degraded }),
    operatorContact: config.OPERATOR_CONTACT ?? null,
    syncEveryMin: Number(config.MAIL_SYNC_EVERY_MIN),
    ...(config.WEB_BASE_URL === undefined ? {} : { webBaseUrl: config.WEB_BASE_URL }),
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
  sendScope: scopeOfSends,
  botUsername: telegram ? () => telegram.botUsername() : null,
  mailOAuthClients: mailOAuth.clients,
  mailOAuthLogin: { oauthTokens: mailOAuth.tokens },
  gate,
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
      loopsAnalyzeRun,
      historyRun,
      regateRun,
      loopsMatchRun,
      committerRun,
      returnedRun,
      expiryRun,
      chaserRun,
      channelRun,
      digestRun,
      operatorRun,
      sloRun,
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
