import { configureMailHosts } from "./modules/mail";
import { configureFeatures, countSsoRequiredWhileKilled } from "./modules/tenancy";
import { ConfigError, featuresOff, isRemovedEnvKey, loadConfig, mailAllowLocal } from "./platform/config";
import { assertAppRole, createDb } from "./platform/db";
import { errorFields } from "./platform/errors";
import { createLog, installConsoleGuard, setLogFormat, setLogLevel, setLogRelease } from "./platform/log";
import { installProcessGuard } from "./platform/process-guard";
import { createStartContext } from "./start/context";
import { startHttp } from "./start/http";
import { startJobs } from "./start/jobs";
import { startMail } from "./start/mail";
import { startOperator } from "./start/operator";
import { startPush } from "./start/push";
import { startTelegram } from "./start/telegram";
import { startTriage } from "./start/triage";

// The start-up: this file loads the config, opens the database and calls one start function per runtime, in this order.
// The order is part of the behaviour (`start/jobs.test.ts` pins it).
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

const ctx = createStartContext({ config, db, log, startedAt });
const mail = await startMail(ctx);
const operator = startOperator(ctx);
const triage = await startTriage(ctx, operator);
const jobs = startJobs(ctx, operator, triage);
startPush(ctx);
startTelegram(ctx, triage, jobs);
startHttp(ctx, mail, operator, triage, jobs);
