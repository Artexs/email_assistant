import { botCommandNames, textTables, type UserLocale, MINUTE_MS } from "@ea/core";
import { GrammyError, type Bot } from "grammy";

import { createLog } from "../../../platform/log";
import type { CommandName } from "../port";

import { telegramErrorFields } from "./errors";

const log = createLog("telegram");

function commandList(locale: UserLocale): { command: CommandName; description: string }[] {
  return botCommandNames.map((command) => ({ command, description: textTables[locale].bot.commands[command] }));
}

// The default menu is English; the Polish menu is for Telegram apps set to Polish.
export const BOT_COMMANDS: readonly { command: CommandName; description: string }[] = commandList("en");

const BASE_DELAY_MS = MINUTE_MS;
const MAX_DELAY_MS = 30 * MINUTE_MS;

export interface PollingDeps {
  sleep?(ms: number, signal: AbortSignal): Promise<void>;
}

export interface Polling {
  stop(): Promise<void>;
  done: Promise<void>;
}

function timerSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish);
  });
}

/**
 * Long polling (ADR 0005). A 401 stops polling; a 409 or any other failure retries after 1, 2, 4 … at most 30 minutes.
 * Log lines hold only codes and numbers, never the token.
 */
export function startPolling(bot: Bot, deps?: PollingDeps): Polling {
  const sleep = deps?.sleep ?? timerSleep;
  const abort = new AbortController();
  let stopping = false;
  let failures = 0;

  // onStart fires after getMe, before the first getUpdates, so a 409 would reset the count at each try.
  // The count resets only when a getUpdates call succeeds.
  bot.api.config.use(async (prev, method, payload, signal) => {
    const response = await prev(method, payload, signal);
    if (method === "getUpdates" && response.ok) {
      failures = 0;
    }
    return response;
  });

  const onStart = (info: { id: number; username: string }): void => {
    log.info("telegram_polling_started", { bot_id: info.id });
    // One call after the other: the default menu first. A failure of one call does not stop the other.
    const warn = (error: unknown): void => log.warn("telegram_set_commands_failed", telegramErrorFields(error));
    void bot.api
      .setMyCommands(BOT_COMMANDS)
      .catch(warn)
      .then(() => bot.api.setMyCommands(commandList("pl"), { language_code: "pl" }))
      .catch(warn);
  };

  const run = async (): Promise<void> => {
    while (!stopping) {
      try {
        await bot.start({ allowed_updates: ["message", "callback_query"], onStart });
        return;
      } catch (error) {
        if (stopping) {
          return;
        }
        if (error instanceof GrammyError && error.error_code === 401) {
          log.error("telegram_polling_token_rejected");
          return;
        }
        failures += 1;
        const delay = Math.min(BASE_DELAY_MS * 2 ** (failures - 1), MAX_DELAY_MS);
        if (error instanceof GrammyError && error.error_code === 409) {
          log.error("telegram_polling_conflict", { wait_ms: delay });
        } else {
          log.error("telegram_polling_failed", { ...telegramErrorFields(error), wait_ms: delay });
        }
        await sleep(delay, abort.signal);
      }
    }
  };

  const done = run();

  return {
    done,
    async stop(): Promise<void> {
      stopping = true;
      abort.abort();
      if (bot.isRunning()) {
        try {
          await bot.stop();
        } catch (error) {
          log.warn("telegram_stop_failed", telegramErrorFields(error));
        }
      }
      await done;
    },
  };
}
