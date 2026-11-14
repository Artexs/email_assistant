import { cutText, textsFor, type UserLocale } from "@ea/core";
import { Bot, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { Transaction } from "kysely";

import type { DB, Db } from "../../../platform/db";
import { errorFields } from "../../../platform/errors";
import { createLog } from "../../../platform/log";
import { getUserAuthProfile } from "../../tenancy";
import { consumeLinkToken } from "../linking";
import { commandNames, type LinkedChat, type UpdateHandlers } from "../port";
import { findChatLink } from "../repo";

import { messageOptions } from "./api";
import { isNotModified, telegramErrorLabel } from "./errors";

const log = createLog("telegram");

const ANSWER_MAX_CHARS = 200;

// The language of a user who has no linked chat yet (D12). A user with no choice gets the default of plan P2: Polish.
async function localeOfUser(db: Db | Transaction<DB>, userId: string): Promise<UserLocale> {
  try {
    return (await getUserAuthProfile(db, userId))?.locale ?? "pl";
  } catch (error) {
    log.warn("telegram_locale_read_failed", { user_id: userId, ...errorFields(error) });
    return "pl";
  }
}

export interface BotDeps {
  db: Db | Transaction<DB>;
  now(): Date;
  handlers: UpdateHandlers;
}

/**
 * The update router. Order: chat guard, `/start` linking, link guard, commands, buttons, other messages.
 * An unlinked chat gets no reply except for a `/start` with a token.
 */
export function createTelegramBot(
  token: string,
  deps: BotDeps,
  opts?: { botInfo?: UserFromGetMe; apiRoot?: string }
): Bot {
  const { db, handlers } = deps;
  const bot = new Bot(token, {
    botInfo: opts?.botInfo,
    client: opts?.apiRoot === undefined ? undefined : { apiRoot: opts.apiRoot },
  });
  const links = new WeakMap<Context, LinkedChat>();

  const reply = (ctx: Context, text: string) => ctx.reply(text, messageOptions([], { clearKeyboard: false }));

  // 1. Chat guard: private chats of people only.
  bot.use(async (ctx, next) => {
    if (!ctx.chat || ctx.chat.type !== "private" || ctx.chat.id <= 0 || ctx.from?.is_bot) {
      return;
    }
    await next();
  });

  // 2. Linking.
  bot.command("start", async (ctx) => {
    const chatId = ctx.chat.id;
    const payload = ctx.match.trim();
    if (payload === "") {
      const link = await findChatLink(db, chatId);
      if (link) await reply(ctx, textsFor(link.locale).bot.help);
      return;
    }
    const result = await consumeLinkToken(db, { token: payload, chatId, now: deps.now() });
    if (result.kind === "linked") {
      log.info(`chat linked for user ${result.userId} in org ${result.orgId}`);
      await reply(ctx, textsFor(await localeOfUser(db, result.userId)).bot.linked);
    } else if (result.kind === "used") {
      log.info("a used link token was tried");
      const link = await findChatLink(db, chatId);
      await reply(
        ctx,
        link ? textsFor(link.locale).bot.alreadyLinked : textsFor(await localeOfUser(db, result.userId)).bot.linkUsed
      );
    } else if (result.kind === "expired") {
      log.info("an expired link token was tried");
      await reply(ctx, textsFor(await localeOfUser(db, result.userId)).bot.linkExpired);
    } else {
      const link = await findChatLink(db, chatId);
      if (link) await reply(ctx, textsFor(link.locale).bot.help);
      else log.debug("ignored /start with an unknown token");
    }
  });

  // 3. Link guard.
  bot.use(async (ctx, next) => {
    const link = ctx.chat ? await findChatLink(db, ctx.chat.id) : undefined;
    if (!link) {
      log.debug("ignored an update from an unlinked chat");
      return;
    }
    links.set(ctx, link);
    await next();
  });

  const linkOf = (ctx: Context): LinkedChat => {
    const link = links.get(ctx);
    if (!link) {
      throw new Error("no link for this update");
    }
    return link;
  };

  // 4. Commands.
  for (const name of commandNames) {
    bot.command(name, async (ctx) => {
      let message: { text: string; buttons: Parameters<typeof messageOptions>[0] };
      try {
        message = await handlers.command(linkOf(ctx), name);
      } catch (error) {
        log.error(`command failed: ${telegramErrorLabel(error)}`);
        message = { text: textsFor(linkOf(ctx).locale).bot.error, buttons: [] };
      }
      try {
        await ctx.reply(message.text, messageOptions(message.buttons, { clearKeyboard: false }));
      } catch (error) {
        log.warn(`replying to a command failed: ${telegramErrorLabel(error)}`);
      }
    });
  }

  // 5. Buttons.
  bot.on("callback_query:data", async (ctx) => {
    const link = linkOf(ctx);
    let result;
    try {
      result = await handlers.callback(link, ctx.callbackQuery.data);
    } catch (error) {
      log.error(`callback failed: ${telegramErrorLabel(error)}`);
      result = { answer: textsFor(link.locale).bot.error };
    }
    try {
      await ctx.answerCallbackQuery({ text: cutText(result.answer, ANSWER_MAX_CHARS) });
    } catch (error) {
      log.warn(`answering a button tap failed: ${telegramErrorLabel(error)}`);
    }
    if (result.edit) {
      try {
        await ctx.editMessageText(result.edit.text, messageOptions(result.edit.buttons, { clearKeyboard: true }));
      } catch (error) {
        if (!isNotModified(error)) {
          log.warn(`editing a message failed: ${telegramErrorLabel(error)}`);
        }
      }
    }
    if (result.send) {
      await ctx.reply(result.send.text, messageOptions(result.send.buttons, { clearKeyboard: false }));
    }
  });

  // 6. Any other message of a linked chat.
  bot.on("message", async (ctx) => {
    await reply(ctx, textsFor(linkOf(ctx).locale).bot.help);
  });

  // 7. Without this, grammY stops polling on the first error.
  bot.catch((err) => {
    log.error(`update ${err.ctx.update.update_id} failed: ${telegramErrorLabel(err.error)}`);
  });

  return bot;
}
