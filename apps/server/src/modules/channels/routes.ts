import {
  notifyPatchSchema,
  TELEGRAM_CONSENT_VERSION,
  telegramConsentBodySchema,
  telegramDetailBodySchema,
  telegramLinkBodySchema,
  telegramLockBodySchema,
  type TelegramConsent,
  type TelegramLink,
  type TelegramState,
} from "@ea/core";
import { Hono, type MiddlewareHandler } from "hono";

import type { Db } from "../../platform/db";
import { parseBody, requireOwner, type ApiEnv } from "../../platform/http";
import { createLog } from "../../platform/log";
import { auditEvents, recordAudit } from "../audit";
import { isFeatureOn } from "../tenancy";

import { channelDocs } from "./api-docs";
import { ownConsentVersion } from "./consent";
import { createLinkToken, unlinkUser } from "./linking";
import { changeNotify, notifyViewOf } from "./notify-settings";
import { getChatLinkForUser } from "./repo";
import { telegramErrorFields } from "./telegram/errors";
import {
  changeTelegramDetail,
  changeTelegramLock,
  linkDetailOf,
  recordTelegramConsent,
  storeTelegramDetail,
  telegramDetailOfMember,
} from "./telegram-detail";

const log = createLog("channels");

export interface ChannelRouteDeps {
  db: Db;
  now(): Date;
  botUsername: (() => Promise<string>) | null; // null: Telegram is off on this server
}

// Every route is for any member: each user links their own chat.
export function channelRoutes(deps: ChannelRouteDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  // The flag comes first: with it off the detail and lock routes are a 404 for every role (docs/code-patterns.md, Add a user command).
  const detailFlagFirst: MiddlewareHandler<ApiEnv> = async (c, next) => {
    if (!(await isFeatureOn(deps.db, c.get("ctx"), "telegram_minimal"))) return c.json({ error: "not_found" }, 404);
    await next();
  };

  app.get("/channels/telegram", channelDocs.getTelegram, async (c) => {
    const ctx = c.get("ctx");
    const { userId } = c.get("session");
    const link = await getChatLinkForUser(deps.db, ctx, userId);
    const botUsername = deps.botUsername ? await deps.botUsername().catch(() => null) : null;
    // Only a linked user has a consent that counts: an unlink withdraws it.
    const consentVersion = link === undefined ? null : await ownConsentVersion(deps.db, ctx, userId);
    const state: TelegramState = {
      available: deps.botUsername !== null,
      linked: link !== undefined,
      linkedAt: link?.linkedAt.toISOString() ?? null,
      botUsername,
      consentVersion,
      ...(await telegramDetailOfMember(deps.db, ctx, userId)),
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
    // `full` is refused while the owner locks `minimal`: no consent row, no token.
    const asked = await linkDetailOf(deps.db, ctx, body.detail);
    if (asked !== undefined && "locked" in asked) return c.json({ error: "telegram_detail_locked" }, 409);
    let username: string;
    try {
      username = await deps.botUsername();
    } catch (error) {
      log.warn("telegram_get_me_failed", { ...telegramErrorFields(error) });
      return c.json({ error: "telegram_unreachable" }, 502);
    }
    // The consent row, the chosen detail level and the token go together: no token without the row. With the flag `telegram_minimal`
    // off the level is not read, stored or checked (`asked` is `undefined`).
    const now = deps.now();
    const { token, expiresAt } = await deps.db.transaction().execute(async (trx) => {
      await recordTelegramConsent(trx, ctx, userId, now);
      if (asked !== undefined && "detail" in asked) await storeTelegramDetail(trx, ctx, userId, asked.detail, now);
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

  // A linked user confirms the current consent text. The user comes from the session, never from the body.
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

  // The own Telegram detail level. The row is the one of the session user: no body names another. `full` records the consent.
  app.patch("/me/telegram-detail", detailFlagFirst, channelDocs.patchTelegramDetail, async (c) => {
    const ctx = c.get("ctx");
    const { userId } = c.get("session");
    const body = await parseBody(c, telegramDetailBodySchema);
    const result = await changeTelegramDetail(deps.db, ctx, userId, body, deps.now());
    if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
    if (result.kind === "locked") return c.json({ error: "telegram_detail_locked" }, 409);
    if (result.kind === "consent_outdated") return c.json({ error: "telegram_consent_outdated" }, 409);
    return c.json(result.answer);
  });

  // The owner locks `minimal` for the organization. The flag first, then the role. Member values stay for the unlock.
  app.patch("/organization/telegram-lock", detailFlagFirst, requireOwner, channelDocs.patchTelegramLock, async (c) => {
    const body = await parseBody(c, telegramLockBodySchema);
    const answer = await changeTelegramLock(deps.db, c.get("ctx"), c.get("session").userId, body.locked, deps.now());
    if (answer === undefined) return c.json({ error: "not_found" }, 404);
    return c.json(answer);
  });

  app.delete("/channels/telegram/link", channelDocs.deleteTelegramLink, async (c) => {
    const ctx = c.get("ctx");
    const { userId } = c.get("session");
    await unlinkUser(deps.db, ctx, userId, deps.now(), { actor: userId });
    return c.body(null, 204);
  });

  // The own quiet hours, report channel and notice routes. The row is the one of the session user: no body names another.
  app.get("/me/notify", channelDocs.getNotify, async (c) => {
    const view = await notifyViewOf(deps.db, c.get("ctx"), c.get("session").userId, deps.now());
    if (view === undefined) return c.json({ error: "not_found" }, 404);
    return c.json(view);
  });

  // A group of keys needs its flag: quiet hours `user_quiet_hours`, the channel `report_mail`, the routes `web_push`; with the flag off a write is a 404.
  app.patch("/me/notify", channelDocs.patchNotify, async (c) => {
    const ctx = c.get("ctx");
    const { userId } = c.get("session");
    const body = await parseBody(c, notifyPatchSchema);
    const result = await changeNotify(deps.db, ctx, userId, body, deps.now());
    if (result.kind !== "ok") return c.json({ error: result.kind }, result.kind === "no_mailbox" ? 409 : 404);
    return c.json(result.view);
  });

  return app;
}
