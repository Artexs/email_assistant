import { telegramLinkBodySchema, telegramLinkSchema, telegramStateSchema } from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the channel routes (ADR 0023). The schemas are the ones the route and the web parse with.
// Every member links their own chat.
const tags = ["channels"];

export const channelDocs = {
  getTelegram: apiDoc({
    operationId: "getTelegram",
    summary: "Whether Telegram is on, and whether the user linked a chat.",
    tags,
    ok: { status: 200, schema: telegramStateSchema },
  }),
  postTelegramLink: apiDoc({
    operationId: "postTelegramLink",
    summary: "Record the consent and make a one-time link to the bot.",
    tags,
    body: telegramLinkBodySchema,
    ok: { status: 200, schema: telegramLinkSchema },
    errors: [
      { status: 409, codes: ["telegram_off", "telegram_consent_outdated"] },
      { status: 502, codes: ["telegram_unreachable"] },
    ],
  }),
  deleteTelegramLink: apiDoc({
    operationId: "deleteTelegramLink",
    summary: "Unlink the Telegram chat of the user.",
    tags,
    ok: { status: 204 },
  }),
};
