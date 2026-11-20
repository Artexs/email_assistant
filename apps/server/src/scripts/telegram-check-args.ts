import { type CliDescription } from "@ea/core";

import { parseFlags } from "./lib/parse-flags";

export const cliDescriptions = [
  {
    name: "telegram:check",
    summary: "Asks the Telegram Bot API who owns TELEGRAM_BOT_TOKEN (getMe).",
    risk: "outside",
    needs: ["telegram"],
    usage: "bun run telegram:check",
    exits: {
      1: "the token or the config is missing or bad, or Telegram refused the token",
      3: "the Telegram Bot API did not answer",
    },
  },
] satisfies readonly CliDescription[];

// The tool takes no argument: any flag or operand is a usage error, before the config or any call.
export function parseTelegramCheckArgs(argv: string[]): void {
  parseFlags({ args: argv, options: {} });
}
