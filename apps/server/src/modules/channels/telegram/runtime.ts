import type { UserFromGetMe } from "grammy/types";
import type { Transaction } from "kysely";

import type { DB, Db, TenantContext } from "../../../platform/db";
import type { ActionsScope, DelegationHooks, SendScope } from "../../actions";
import { createUpdateHandlers } from "../commands";
import { scheduleDigests } from "../digest-job";
import { detectNotices } from "../notices";
import { createOutboxSender } from "../sender";

import { createTelegramChannel } from "./api";
import { createTelegramBot } from "./bot";
import { startPolling, type Polling } from "./polling";

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
  // Only for tests.
  apiRoot?: string;
  botInfo?: UserFromGetMe;
}

export interface TelegramRuntime {
  notify(): Promise<void>;
  scheduleDigests(): Promise<void>;
  startPolling(): void;
  stop(): Promise<void>;
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
      }),
    },
    { botInfo: deps.botInfo, apiRoot: deps.apiRoot }
  );
  const sender = createOutboxSender({ db, channel: createTelegramChannel(bot.api), now });
  let polling: Polling | undefined;

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
  };
}
