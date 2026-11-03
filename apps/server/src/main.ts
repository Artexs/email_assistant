import { ConfigError, loadConfig } from "./platform/config";
import { assertAppRole, checkDb, createDb } from "./platform/db";
import { createApp } from "./platform/http";
import { createLog, setLogLevel } from "./platform/log";

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

let stopping = false;

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await server.stop();
  await db.destroy();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
