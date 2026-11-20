import { EXIT } from "@ea/core";

import { checkBot, telegramErrorLabel } from "../modules/channels";
import { exitCodeOf, runCli, type CliRawOutput, type CliSpec } from "../platform/cli";
import { ConfigError, loadConfig, type Config } from "../platform/config";
import { describeError } from "../platform/errors";

import { cliDescriptions, parseTelegramCheckArgs } from "./telegram-check-args";

function readConfig(out: CliRawOutput): Config | undefined {
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

const main: CliSpec["main"] = async (argv, out) => {
  // Parse first: a bad argument exits 2 before the config or any call.
  parseTelegramCheckArgs(argv);
  const config = readConfig(out);
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
    const code = exitCodeOf(error);
    // A Telegram error is never printed with its message: it can hold the token (`telegramErrorLabel`).
    out.fail(
      code === EXIT.unreachable ? `unreachable: ${describeError(error)}` : `failed: ${telegramErrorLabel(error)}`
    );
    return code;
  }
};

if (import.meta.main) await runCli({ prefix: "telegram-check", descriptions: cliDescriptions, main });
