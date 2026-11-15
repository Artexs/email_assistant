import {
  TELEGRAM_CONSENT_VERSION,
  telegramConsentBodySchema,
  telegramLinkBodySchema,
  type TelegramConsent,
  type TelegramLink,
  type TelegramState,
} from "@ea/core";
import { Hono } from "hono";

import type { Db } from "../../platform/db";
import { parseBody, type ApiEnv } from "../../platform/http";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";

import { channelDocs } from "./api-docs";
import { createLinkToken, unlinkUser } from "./linking";
import { getChatLinkForUser } from "./repo";
import { telegramErrorFields } from "./telegram/errors";

const log = createLog("channels");

export interface ChannelRouteDeps {
  db: Db;
  now(): Date;
  botUsername: (() => Promise<string>) | null; // null: Telegram is off on this server
}

// Every route is for any member: each user links their own chat.
export function channelRoutes(deps: ChannelRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.get("/channels/telegram", channelDocs.getTelegram, async (c) => {
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

  app.post("/channels/telegram/link", channelDocs.postTelegramLink, async (c) => {
    if (deps.botUsername === null) return c.json({ error: "telegram_off" }, 409);
    const ctx = c.get("ctx");
    const { userId } = c.get("session");
    const body = await parseBody(c, telegramLinkBodySchema);
    if (body.consentVersion !== TELEGRAM_CONSENT_VERSION) {
      return c.json({ error: "telegram_consent_outdated" }, 409);
    }
    let username: string;
    try {
      username = await deps.botUsername();
    } catch (error) {
      log.warn("telegram_get_me_failed", { ...telegramErrorFields(error) });
      return c.json({ error: "telegram_unreachable" }, 502);
    }
    // The consent row and the token go together: no token without the row.
    const now = deps.now();
    const { token, expiresAt } = await deps.db.transaction().execute(async (trx) => {
      await recordAudit(trx, ctx, {
        event: auditEvents.webTelegramConsent,
        actor: userId,
        data: { via: "web", version: TELEGRAM_CONSENT_VERSION },
        at: now,
      });
      return createLinkToken(trx, ctx, userId, now);
    });
    log.info("telegram_link_made", { user_id: userId });
    c.header("Cache-Control", "no-store");
    const linkAnswer: TelegramLink = {
      url: `https://t.me/${username}?start=${token}`,
      expiresAt: expiresAt.toISOString(),
    };
    return c.json(linkAnswer);
  });

  // A linked user confirms the current consent text (F116 stage 17). The user comes from the session, never from the body.
  app.post("/telegram/consent", channelDocs.postTelegramConsent, async (c) => {
    const ctx = c.get("ctx");
    const { userId } = c.get("session");
    const body = await parseBody(c, telegramConsentBodySchema);
    if (body.version !== TELEGRAM_CONSENT_VERSION) {
      return c.json({ error: "telegram_consent_outdated" }, 409);
    }
    await recordAudit(deps.db, ctx, {
      event: auditEvents.webTelegramConsent,
      actor: userId,
      data: { via: "web", version: TELEGRAM_CONSENT_VERSION },
      at: deps.now(),
    });
    log.info("telegram_consent_confirmed", { user_id: userId });
    const answer: TelegramConsent = { version: TELEGRAM_CONSENT_VERSION };
    return c.json(answer);
  });

  app.delete("/channels/telegram/link", channelDocs.deleteTelegramLink, async (c) => {
    const ctx = c.get("ctx");
    const { userId } = c.get("session");
    await unlinkUser(deps.db, ctx, userId, deps.now(), { actor: userId });
    return c.body(null, 204);
  });

  return app;
}
