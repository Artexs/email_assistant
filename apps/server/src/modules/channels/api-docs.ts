import {
  notifyPatchSchema,
  notifyViewSchema,
  telegramConsentBodySchema,
  telegramConsentSchema,
  telegramLinkBodySchema,
  telegramLinkSchema,
  telegramStateSchema,
} from "@ea/core";

import { apiDoc } from "../../platform/openapi";

// The OpenAPI description of the channel routes (ADR 0023). The schemas are the ones the route and the web parse with.
// Every member links their own chat.
const tags = ["channels"];

export const channelDocs = {
  getNotify: apiDoc({
    operationId: "getNotify",
    summary: "The own quiet hours and report channel, with the active mailboxes that can get the report mail.",
    tags,
    ok: { status: 200, schema: notifyViewSchema },
    errors: [{ status: 404, codes: ["not_found"] }],
  }),
  patchNotify: apiDoc({
    operationId: "patchNotify",
    summary:
      "Change the own quiet hours (both times, or both null to reset) or the own report channel (telegram, mail or both). Each needs its flag.",
    tags,
    body: notifyPatchSchema,
    ok: { status: 200, schema: notifyViewSchema },
    errors: [
      { status: 404, codes: ["not_found"] },
      { status: 409, codes: ["no_mailbox"] },
    ],
  }),
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
  postTelegramConsent: apiDoc({
    operationId: "postTelegramConsent",
    summary: "Confirm the current Telegram consent text for the signed-in user.",
    tags,
    body: telegramConsentBodySchema,
    ok: { status: 200, schema: telegramConsentSchema },
    errors: [{ status: 409, codes: ["telegram_consent_outdated"] }],
  }),
  deleteTelegramLink: apiDoc({
    operationId: "deleteTelegramLink",
    summary: "Unlink the Telegram chat of the user.",
    tags,
    ok: { status: 204 },
  }),
};
