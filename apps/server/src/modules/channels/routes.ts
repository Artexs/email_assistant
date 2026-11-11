import type { TelegramLink, TelegramState } from "@ea/core";
import { Hono } from "hono";

import type { Db } from "../../platform/db";
import type { ApiEnv } from "../../platform/http";
import { createLog } from "../../platform/log";

import { createLinkToken, unlinkUser } from "./linking";
import { getChatLinkForUser } from "./repo";
import { telegramErrorLabel } from "./telegram/errors";

const log = createLog("channels");

export interface ChannelRouteDeps {
  db: Db;
  now(): Date;
  botUsername: (() => Promise<string>) | null; // null: Telegram is off on this server
}

// Every route is for any member: each user links their own chat.
export function channelRoutes(deps: ChannelRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.get("/channels/telegram", async (c) => {
    const ctx = c.get("ctx");
    const { userId } = c.get("session");
    const link = await getChatLinkForUser(deps.db, ctx, userId);
    const botUsername = deps.botUsername ? await deps.botUsername().catch(() => null) : null;
    const state: TelegramState = {
      available: deps.botUsername !== null,
      linked: link !== undefined,
      linkedAt: link?.linkedAt.toISOString() ?? null,
      botUsername,
    };
    return c.json(state);
  });

  app.post("/channels/telegram/link", async (c) => {
    if (deps.botUsername === null) return c.json({ error: "telegram_off" }, 409);
    const ctx = c.get("ctx");
    const { userId } = c.get("session");
    let username: string;
    try {
      username = await deps.botUsername();
    } catch (error) {
      log.warn(`web: telegram getMe failed: ${telegramErrorLabel(error)}`);
      return c.json({ error: "telegram_unreachable" }, 502);
    }
    const { token, expiresAt } = await createLinkToken(deps.db, ctx, userId, deps.now());
    log.info(`web: telegram link made for user ${userId}`);
    c.header("Cache-Control", "no-store");
    const linkAnswer: TelegramLink = {
      url: `https://t.me/${username}?start=${token}`,
      expiresAt: expiresAt.toISOString(),
    };
    return c.json(linkAnswer);
  });

  app.delete("/channels/telegram/link", async (c) => {
    const ctx = c.get("ctx");
    const { userId } = c.get("session");
    await unlinkUser(deps.db, ctx, userId, deps.now(), { actor: userId });
    return c.body(null, 204);
  });

  return app;
}
