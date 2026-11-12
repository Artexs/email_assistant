import type { UserFromGetMe } from "grammy/types";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../../platform/db";
import { SoftError } from "../../../platform/errors";
import type { ActionsScope, DelegationHooks, SendScope } from "../../actions";
import { createUpdateHandlers } from "../commands";
import { scheduleDigests } from "../digest-job";
import { detectNotices } from "../notices";
import { createOutboxSender } from "../sender";

import { createTelegramChannel } from "./api";
import { createTelegramBot } from "./bot";
import { startPolling, type Polling } from "./polling";

// grammY's own API timeout is 500 s: a `getMe` that never answers must not hold `/api/me`.
const BOT_USERNAME_TIMEOUT_MS = 3_000;

/** Keeps the promise of a successful `load`; a rejection is dropped, so the next call tries again. */
export function cacheOnSuccess<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return () => {
    if (cached) return cached;
    const attempt = load();
    cached = attempt;
    attempt.catch(() => {
      if (cached === attempt) cached = undefined;
    });
    return attempt;
  };
}

/** Rejects with a `SoftError` when the promise does not settle in `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SoftError("telegram getMe timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface TelegramRuntimeDeps {
  db: Db | Transaction<DB>;
  token: string;
  now(): Date;
  startedAt: Date;
  llmDailyCap: number;
  triageScope: "off" | "synthetic" | "all";
  actionsScope: ActionsScope;
  llm: { provider: string; classifierModel: string };
  hooks: DelegationHooks;
  uidplus(ctx: TenantContext, mailboxId: string): Promise<boolean>;
  sendScope: SendScope;
  operatorContact: string | null;
  // Tests, and TELEGRAM_API_ROOT (loopback only, platform/config).
  apiRoot?: string;
  // Only for tests.
  botInfo?: UserFromGetMe;
}

export interface TelegramRuntime {
  notify(): Promise<void>;
  scheduleDigests(): Promise<void>;
  startPolling(): void;
  stop(): Promise<void>;
  botUsername(): Promise<string>;
}

/** The bot, the notifier and the digest job of the server. `main.ts` builds it only when the token is set. */
export function createTelegramRuntime(deps: TelegramRuntimeDeps): TelegramRuntime {
  const { db, token, now, startedAt } = deps;
  const bot = createTelegramBot(
    token,
    {
      db,
      now,
      handlers: createUpdateHandlers({
        db,
        now,
        llmDailyCap: deps.llmDailyCap,
        triageScope: deps.triageScope,
        actionsScope: deps.actionsScope,
        llm: deps.llm,
        hooks: deps.hooks,
        uidplus: deps.uidplus,
        sendScope: deps.sendScope,
        operatorContact: deps.operatorContact,
      }),
    },
    { botInfo: deps.botInfo, apiRoot: deps.apiRoot }
  );
  const sender = createOutboxSender({ db, channel: createTelegramChannel(bot.api), now });
  let polling: Polling | undefined;
  const loadBotUsername = cacheOnSuccess(() => bot.api.getMe().then((me) => me.username));
  const botUsername = () => withTimeout(loadBotUsername(), BOT_USERNAME_TIMEOUT_MS);

  return {
    async notify() {
      await detectNotices({ db, now, startedAt });
      await sender.run();
    },
    scheduleDigests: () => scheduleDigests({ db, now }),
    startPolling() {
      polling ??= startPolling(bot);
    },
    async stop() {
      await polling?.stop();
    },
    botUsername,
  };
}
