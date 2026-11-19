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
    summary:
      "The own quiet hours, report channel and notice routes. `routes` is the stored choice per group (urgent, approvals, updates: telegram, push or both). `routeDefaults` is where each group goes with no stored choice, for the chat and live push devices of the member. Active mailboxes that can get the report mail.",
    tags,
    ok: { status: 200, schema: notifyViewSchema },
    errors: [{ status: 404, codes: ["not_found"] }],
  }),
  patchNotify: apiDoc({
    operationId: "patchNotify",
    summary:
      "Change the own quiet hours (both times, or both null to reset), the own report channel (telegram, mail or both) or the own notice routes (`routes`: telegram, push or both per group; a group not in the body keeps its value, null removes it). One group of keys per body. Quiet hours need `user_quiet_hours`, the channel `report_mail`, the routes `web_push`.",
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
    summary:
      "Whether Telegram is on, and whether the user linked a chat. `consentVersion` is the consent of the user that an unlink did not withdraw (null: none, or not linked).",
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
