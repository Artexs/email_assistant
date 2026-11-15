import { checkBot, telegramErrorLabel } from "../modules/channels";
import { createCliOutput } from "../platform/cli";
import { ConfigError, loadConfig, type Config } from "../platform/config";

const out = createCliOutput("telegram-check");

function readConfig(): Config | undefined {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      out.fail(`config error: missing or bad keys: ${error.keys.join(", ")}`);
    } else {
      out.fail("config error");
    }
    return undefined;
  }
}

async function main(): Promise<number> {
  const config = readConfig();
  if (config === undefined) return 1;
  if (config.TELEGRAM_BOT_TOKEN === undefined) {
    out.fail("TELEGRAM_BOT_TOKEN is not set");
    return 1;
  }
  try {
    const { id, username } = await checkBot(config.TELEGRAM_BOT_TOKEN, { apiRoot: config.TELEGRAM_API_ROOT });
    out.print(`bot @${username} (id ${id})`);
    return 0;
  } catch (error) {
    out.fail(`failed: ${telegramErrorLabel(error)}`);
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    out.fail(`failed: ${telegramErrorLabel(error)}`);
    process.exit(1);
  });
