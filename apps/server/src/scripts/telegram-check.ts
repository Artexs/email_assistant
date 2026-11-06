import { checkBot, telegramErrorLabel } from "../modules/channels";
import { loadConfig } from "../platform/config";
import { createLog } from "../platform/log";

const log = createLog("telegram-check");

async function main(): Promise<number> {
  const config = loadConfig();
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
