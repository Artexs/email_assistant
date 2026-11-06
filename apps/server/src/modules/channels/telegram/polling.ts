import { GrammyError, type Bot } from "grammy";

import { createLog } from "../../../platform/log";
import type { CommandName } from "../port";

import { telegramErrorLabel } from "./errors";

const log = createLog("telegram");

export const BOT_COMMANDS: readonly { command: CommandName; description: string }[] = [
  { command: "digest", description: "The digest now" },
  { command: "status", description: "Mailboxes, last sync, LLM calls" },
  { command: "pause", description: "Stop reading and triage" },
  { command: "resume", description: "Start reading and triage again" },
  { command: "help", description: "The command list" },
];

const BASE_DELAY_MS = 60_000;
const MAX_DELAY_MS = 30 * 60_000;

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
 * Log lines hold only labels, never the token.
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
    log.info(`telegram: polling as @${info.username} (id ${info.id})`);
    bot.api.setMyCommands(BOT_COMMANDS).catch((error: unknown) => {
      log.warn(`telegram: setMyCommands failed: ${telegramErrorLabel(error)}`);
    });
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
          log.error("telegram: the bot token was rejected (401): check TELEGRAM_BOT_TOKEN; polling stopped");
          return;
        }
        failures += 1;
        const delay = Math.min(BASE_DELAY_MS * 2 ** (failures - 1), MAX_DELAY_MS);
        const minutes = Math.round(delay / 60_000);
        if (error instanceof GrammyError && error.error_code === 409) {
          log.error(
            `telegram: another process polls this bot token (409); dev and pilot must use different bots (ADR 0005); next try in ${minutes} min`
          );
        } else {
          log.error(`telegram: polling failed: ${telegramErrorLabel(error)}; next try in ${minutes} min`);
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
          log.warn(`telegram: stopping the bot failed: ${telegramErrorLabel(error)}`);
        }
      }
      await done;
    },
  };
}
