import { directSender, telegramErrorLabel } from "../modules/channels";
import { sendTestAlerts } from "../modules/operator";
import { runCli, type CliSpec } from "../platform/cli";
import { ConfigError, loadConfig, operatorChatId } from "../platform/config";

import { cliDescriptions, parseOpsAlertTestArgs } from "./ops-alert-test-args";

// Sends the `test` text of one kind or of all kinds to the operator chat, through the same send as the job. It writes no alert row.
const main: CliSpec["main"] = async (argv, out) => {
  const args = parseOpsAlertTestArgs(argv);
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    out.fail(
      error instanceof ConfigError ? `config error: missing or bad keys: ${error.keys.join(", ")}` : "config error"
    );
    return 1;
  }
  const chat = operatorChatId(config);
  const send =
    chat === null || config.TELEGRAM_BOT_TOKEN === undefined
      ? null
      : directSender(config.TELEGRAM_BOT_TOKEN, chat, { apiRoot: config.TELEGRAM_API_ROOT });
  const now = new Date();
  try {
    // A send error stops the run: the lines printed so far are the kinds that went out.
    await sendTestAlerts({
      kinds: args.kinds,
      send,
      now,
      locale: config.OPERATOR_LOCALE,
      report: (result) =>
        out.print(result.outcome === "sent" ? `sent ${result.kind}` : `unsent ${result.kind} no_chat`),
    });
    return 0;
  } catch (error) {
    out.fail(`failed: ${telegramErrorLabel(error)}`);
    return 1;
  }
};

if (import.meta.main) {
  await runCli({ prefix: "ops-alert-test", descriptions: cliDescriptions, main });
}
