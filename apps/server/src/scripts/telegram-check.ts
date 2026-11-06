import { checkBot, telegramErrorLabel } from "../modules/channels";
import { ConfigError, loadConfig, type Config } from "../platform/config";
import { createLog } from "../platform/log";

const log = createLog("telegram-check");

function readConfig(): Config | undefined {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      log.error(`config error: missing or bad keys: ${error.keys.join(", ")}`);
    } else {
      log.error("config error");
    }
    return undefined;
  }
}

async function main(): Promise<number> {
  const config = readConfig();
  if (config === undefined) return 1;
  if (config.TELEGRAM_BOT_TOKEN === undefined) {
    log.error("TELEGRAM_BOT_TOKEN is not set");
    return 1;
  }
  try {
    const { id, username } = await checkBot(config.TELEGRAM_BOT_TOKEN);
    log.info(`bot @${username} (id ${id})`);
    return 0;
  } catch (error) {
    log.error(`failed: ${telegramErrorLabel(error)}`);
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    log.error(`failed: ${telegramErrorLabel(error)}`);
    process.exit(1);
  });
