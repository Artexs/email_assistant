import { createMailSyncJob, openImapProvider } from "./modules/mail";
import { ConfigError, loadConfig } from "./platform/config";
import { createSecretBox } from "./platform/crypto";
import { assertAppRole, checkDb, createDb } from "./platform/db";
import { createHeartbeat } from "./platform/heartbeat";
import { createApp } from "./platform/http";
import { createLog, setLogLevel } from "./platform/log";
import { createScheduler } from "./platform/scheduler";

const log = createLog("main");

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
void heartbeat.tick();

let stopping = false;

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  scheduler.stop();
  await server.stop();
  await db.destroy();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
