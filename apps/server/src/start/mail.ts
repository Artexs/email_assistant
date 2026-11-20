import { readFile, statfs } from "node:fs/promises";

import {
  actionsScope,
  committerDeps,
  gateEvidenceOf,
  isOwnMailOf,
  mailOAuthRuntime,
  sendScope,
  senderProfileReader,
  settingsDeps,
  trustEvidenceOf,
  uidplusOf,
} from "./composition";
import { createCommitterJob, createExpiryJob, sentOriginOf } from "./modules/actions";
import {
  cardEditHooks,
  createImapReportMailbox,
  createOperatorNotices,
  createPushSender,
  createReportMailSender,
  createTelegramRuntime,
} from "./modules/channels";
import { createContactsRefreshJob } from "./modules/contacts";
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
import {
  createReplyJobs,
  createReplySweep,
  createStylePreview,
  replySampleScope,
  type ReplySampleScope,
  type StylePreview,
} from "./modules/replies";
import { configureFeatures, countSsoRequiredWhileKilled, listOrganizations } from "./modules/tenancy";
import { createLlmPause, createReturnedJob, createTriageJob, type LlmPause, type TriageScope } from "./modules/triage";
import { createHistoryJob, createTripwireJob, regateAll, type RegateDeps } from "./modules/trust";
import {
  ConfigError,
  featuresOff,
  isRemovedEnvKey,
  llmRoleTable,
  loadConfig,
  mailAllowLocal,
  mailSyncCron,
  operatorChatId,
  pushConfigOf,
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
import { createLlmClient, llmEndpointFields, llmProviders, type LlmProviderId } from "./platform/llm";
import { createLog, installConsoleGuard, setLogFormat, setLogLevel, setLogRelease } from "./platform/log";
import { installProcessGuard } from "./platform/process-guard";
import { createScheduler } from "./platform/scheduler";
import { createRetentionJob } from "./retention";
import { createRunTracker } from "./start/runs";
import { createShutdown } from "./start/shutdown";
import { webDeps } from "./web";

const log = createLog("main");
const startedAt = new Date();

function loadConfigOrExit() {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // A removed key carries `reason=key_removed`: the operator deletes that line from `.env`.
      for (const key of error.keys) {
        log.error("config_key_bad", { config_key: key, ...(isRemovedEnvKey(key) ? { reason: "key_removed" } : {}) });
      }
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

// A killed `sso_sign_in` locks out every member of an organization that requires SSO, except its break-glass owner.
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
  isOwnActionId: isOwnMailOf(db),
  sentOriginOf: (ctx, mailboxId, actionId) => sentOriginOf(db, ctx, mailboxId, actionId),
  now: () => new Date(),
});
const heartbeat = createHeartbeat({ url: config.HEARTBEAT_URL, checkDb: () => checkDb(db) });
if (config.HEARTBEAT_URL === undefined) log.warn("heartbeat_off");
if (config.WEB_BASE_URL !== undefined && config.OPERATOR_CONTACT === undefined) {
  log.warn("operator_contact_empty");
}

const scheduler = createScheduler();
// The newest run of each job that shutdown waits for.
const runs = createRunTracker();
scheduler.add("mail.sync", mailSyncCron(config), mailSync.run);
log.info("mail_sync_interval", { minutes: Number(config.MAIL_SYNC_EVERY_MIN) });
scheduler.add("platform.heartbeat", "*/5 * * * *", heartbeat.tick);

// When a scope is `all`, one start line says whom the jobs act on (counts only, no ids). A DB error does not stop the start.
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

// Operator notices: the chat id is private data and never reaches a log line.
const operatorChat = operatorChatId(config);
const operatorSend =
  operatorChat === null
    ? null
    : async (text: string): Promise<void> => {
        if (telegram === null) throw new Error("telegram is off");
        await telegram.sendDirect(operatorChat, text);
      };
const operator = createOperatorNotices({
  db,
  now: () => new Date(),
  send: operatorSend,
  locale: config.OPERATOR_LOCALE,
});
// prettier-ignore
scheduler.add("channels.operator", "0 13 * * * *", runs.track("channels.operator", () => operator.run()));
log.info("operator_notices_on", { kind: operatorChat === null ? "log" : "telegram" });

// The service-level alerts. The job runs in every case: with no operator chat the `slo_alert_sent` line is the send.
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
// prettier-ignore
scheduler.add("ops.slo", "30 */5 * * * *", runs.track("ops.slo", () =>
  runSloTick(
    { db, checks: sloChecks, send: operatorSend, cfg: slo, log, locale: config.OPERATOR_LOCALE },
    new Date()
  )
));

// One pause object for the triage worker and the `not_triaged` notice job: they run in this process.
let degraded: { pause: LlmPause; scope: TriageScope } | undefined;
// The style preview of the reply drafts: it needs the model client, so it exists only while the LLM scope is on.
let stylePreview: StylePreview | null = null;
let replySamples: ReplySampleScope | null = null;
// The hooks of the delegation and the card edits, the send scope and the UIDPLUS read: the committer, the expiry job and the reply drafter share them.
const scopeOfSends = sendScope(config);
const hooks = delegationHooks({ db });
const uidplus = uidplusOf(db);
const llmTable = llmRoleTable(config);
const classifierRow = llmTable.roles.classifier;
// The global evidence of this classifier: the gate files are read once here and passed to the settings deps.
const gate = gateEvidenceOf(config, { table: llmTable });
const scope = triageScope(config, classifierRow.provider);
// The re-gate of `auto` (ADR 0028, rule 16 of the product rules): it runs once here, before the triage worker and the committer exist, so a `ready` move that
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
const regateJob = () => regateAll({ ...regateDeps, run: "job" }, new Date()).then(() => undefined);
scheduler.add("trust.regate", "20 */5 * * * *", runs.track("trust.regate", regateJob));
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
    readProfile: senderProfileReader({ db, credentialsKey: config.CREDENTIALS_KEY, now: () => new Date() }),
    onCapReached: (ctx, mailboxId, dayStart) => operator.capReached(ctx, mailboxId, dayStart, config.LLM_DAILY_CAP),
  });
  // prettier-ignore
  scheduler.add("triage.worker", "*/15 * * * * *", runs.track("triage.worker", () => triage.run()));
  // The history check of the trust ladder: it reads mail, classifies a sample with the model client and the pause of the triage worker, and writes the checks.
  const history = createHistoryJob({
    db,
    secrets,
    openProvider: openImapProvider,
    oauthTokens: mailOAuth.tokens,
    isOwnActionId: isOwnMailOf(db),
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
  // prettier-ignore
  scheduler.add("trust.history", "*/15 * * * * *", runs.track("trust.history", () => history.run()));
  log.info("job_scheduled", { job: "trust.history" });
  // The Sent analysis of the open loops uses the same model client and the same scope: with the scope off, no mail goes out.
  const loopJobs = createLoopJobs({
    db,
    llm,
    dailyCap: config.LLM_DAILY_CAP,
    credentialsKey: config.CREDENTIALS_KEY,
    scope,
    now: () => new Date(),
  });
  // prettier-ignore
  scheduler.add("loops.analyze", "35 * * * * *", runs.track("loops.analyze", () => loopJobs.analyze.run().then(() => undefined)));
  log.info("job_scheduled", { job: "loops.analyze" });
  // The reply drafter: it scans triaged `needs_reply` mail, claims the requests and writes a draft that waits for one tap. It never
  // sends. It has its own LLM pause, the same model client and the same scope: with the scope off, no mail goes out.
  const replyJobs = createReplyJobs({
    db,
    llm,
    dailyCap: config.LLM_DAILY_CAP,
    scope,
    hooks,
    approvalHooks: cardEditHooks({ sendScope: scopeOfSends }),
    uidplus,
    now: () => new Date(),
    onCapReached: (ctx, mailboxId, dayStart) => operator.capReached(ctx, mailboxId, dayStart, config.LLM_DAILY_CAP),
  });
  stylePreview = createStylePreview({
    db,
    llm,
    realMail: llmProviders[llmTable.roles.drafter.provider].realMail,
    dailyCap: config.LLM_DAILY_CAP,
    now: () => new Date(),
  });
  // The sample drafts are queued for the drafter job above, so they follow its scope: with `synthetic` only test mail is a candidate.
  replySamples = replySampleScope(scope, () => new Date());
  // prettier-ignore
  scheduler.add("replies.drafter", "*/15 * * * * *", runs.track("replies.drafter", () => replyJobs.drafter.run().then(() => undefined)));
  log.info("job_scheduled", { job: "replies.drafter" });
}
// The tripwire of the trust ladder: a category whose moves the user corrects loses its `auto`. It reads corrections and checks, not
// mail, and calls no model, so it runs with the scope off too.
const tripwire = createTripwireJob({
  db,
  settings: settingsDeps(db, () => new Date(), gate),
  testMail: testMailRule(config),
  ...(config.WEB_BASE_URL === undefined ? {} : { webBaseUrl: config.WEB_BASE_URL }),
  now: () => new Date(),
});
// prettier-ignore
scheduler.add("trust.tripwire", "0 * * * * *", runs.track("trust.tripwire", () => tripwire.run()));
log.info("job_scheduled", { job: "trust.tripwire" });
// The close rules need no model: they run with the scope off too, so a reply still closes its loop.
const loopMatch = createLoopMatchJob({ db, now: () => new Date() });
// prettier-ignore
scheduler.add("loops.match", "50 */2 * * * *", runs.track("loops.match", () => loopMatch.run().then(() => undefined)));
log.info("job_scheduled", { job: "loops.match" });
// The sender profiles: one recompute of each active mailbox with the flag `sender_context` on, hourly at minute 7. It reads the
// database only and calls no model, so it runs with the scope off too.
const contactsRefresh = createContactsRefreshJob({
  db,
  credentialsKey: config.CREDENTIALS_KEY,
  testMail: testMailRule(config),
  now: () => new Date(),
});
// prettier-ignore
scheduler.add("contacts.refresh", "0 7 * * * *", runs.track("contacts.refresh", () => contactsRefresh.run().then(() => undefined)));
log.info("job_scheduled", { job: "contacts.refresh" });
// The sweep of the reply drafts: it closes an open reply whose mail was answered, left its folder or got a newer mail in its thread. It
// reads the database only and calls no model and no mailbox, so it runs with the scope off too.
const replySweep = createReplySweep({
  db,
  hooks,
  approvalHooks: cardEditHooks({ sendScope: scopeOfSends }),
  uidplus,
  now: () => new Date(),
});
// prettier-ignore
scheduler.add("replies.sweep", "40 */5 * * * *", runs.track("replies.sweep", () => replySweep.run().then(() => undefined)));
log.info("job_scheduled", { job: "replies.sweep" });

const scopeOfActions = actionsScope(config);
const limitsOfSends = sendLimits(config);
log.info("send_limits", {
  mailbox_hour: limitsOfSends.mailboxHour,
  mailbox_day: limitsOfSends.mailboxDay,
  recipient_day: limitsOfSends.recipientDay,
});
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
// prettier-ignore
scheduler.add("actions.committer", "*/15 * * * * *", runs.track("actions.committer", () => committer.run()));
const expiry = createExpiryJob({ db, now: () => new Date(), hooks, uidplus });
// prettier-ignore
scheduler.add("actions.expiry", "0 7 * * * *", runs.track("actions.expiry", () => expiry.run()));
log.info("job_scheduled", { job: "actions.expiry" });
// The one chaser (delegation reminders, loop follow-ups, stale and expired loops). It replaces `delegation.chaser`.
const chaser = createLoopChaserJob({ db, now: () => new Date() });
// prettier-ignore
scheduler.add("loops.chaser", "20 */15 * * * *", runs.track("loops.chaser", () => chaser.run().then(() => undefined)));
log.info("job_scheduled", { job: "loops.chaser" });
const returned = createReturnedJob({ db, now: () => new Date() });
// prettier-ignore
scheduler.add("triage.returned", "*/15 * * * * *", runs.track("triage.returned", () => returned.run()));

// The daily retention run.
const retention = createRetentionJob({ db, now: () => new Date() });
// prettier-ignore
scheduler.add("platform.retention", "0 40 2 * * *", runs.track("platform.retention", () => retention.run()));
log.info("job_scheduled", { job: "platform.retention" });

// The report mail sender (ADR 0022): it APPENDs the `mail` rows into the user's own INBOX. It runs with or without the
// Telegram runtime, because a mail-only member needs no bot. It never sends: no SMTP sender is built for it. Rows exist only when the flag
// `report_mail` is on, and the sender checks the flag again before each APPEND.
const reportMail = createReportMailSender({
  db,
  mailbox: createImapReportMailbox({
    db,
    secrets,
    openProvider: openImapProvider,
    oauthTokens: mailOAuth.tokens,
    now: () => new Date(),
  }),
  now: () => new Date(),
  ...(config.WEB_BASE_URL === undefined ? {} : { webBaseUrl: config.WEB_BASE_URL }),
});
// prettier-ignore
scheduler.add("channels.report_mail", "*/15 * * * * *", runs.track("channels.report_mail", () => reportMail.run()));
log.info("job_scheduled", { job: "channels.report_mail" });
// The push sender (E9b, ADR 0032): the `push` rows of the outbox go to the browsers of the members as Web Push messages. It needs the VAPID keys
// and no Telegram bot: a push-only member has none. Without the keys the job does not exist and the rows would wait (they exist
// only with the flag `web_push` on, which the panel allows only on a server that has the keys). The request uses the global `fetch`
// (it honours `HTTPS_PROXY`, see `PushSenderDeps`); the sender checks the flag again for every row.
const pushKeys = pushConfigOf(config);
if (pushKeys === null) {
  log.info("push_off");
} else {
  const pushSender = createPushSender({ db, box: secrets, keys: pushKeys, fetch, now: () => new Date() });
  // prettier-ignore
  scheduler.add("channels.push", "*/15 * * * * *", runs.track("channels.push", () => pushSender.run()));
  log.info("job_scheduled", { job: "channels.push" });
}
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
    trustEvidence: trustEvidenceOf(db, () => new Date(), gate, testMailRule(config)),
    operatorContact: config.OPERATOR_CONTACT ?? null,
    syncEveryMin: Number(config.MAIL_SYNC_EVERY_MIN),
    ...(config.WEB_BASE_URL === undefined ? {} : { webBaseUrl: config.WEB_BASE_URL }),
  });
  telegram = runtime;
  // prettier-ignore
  scheduler.add("channels.notifier", "*/15 * * * * *", runs.track("channels.notifier", () => runtime.notify()));
  // prettier-ignore
  scheduler.add("channels.digest", "5 * * * * *", runs.track("channels.digest", () => runtime.scheduleDigests()));
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
  stylePreview,
  replySamples,
  onAuthMailFailed: (ctx, userId, kind, code) => operator.authMailFailed(ctx, userId, kind, code, new Date()),
});
const app = createApp({ checkDb: () => checkDb(db), web });
// idleTimeout: the connect route runs a mailbox login inside the request; Bun's default is 10 s.
const server = Bun.serve({ port: config.PORT, idleTimeout: 90, fetch: app.fetch });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The steps are read at shutdown time: `telegram` is set late and must be seen as it is then.
const shutdown = createShutdown(() => {
  const runtime = telegram;
  return {
    stopScheduler: () => scheduler.stop(),
    stopTelegram: runtime === null ? null : () => runtime.stop(),
    settled: () => runs.settled(),
    stopServer: () => server.stop(),
    closeWeb: async () => {
      await web?.close();
    },
    destroyDb: () => db.destroy(),
    exit: (code) => process.exit(code),
    sleep,
  };
});

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

// After the handlers: this line says the server is ready. A SIGTERM before the handlers exist would kill the process with exit 143.
log.info("server_listening", { port: server.port });
