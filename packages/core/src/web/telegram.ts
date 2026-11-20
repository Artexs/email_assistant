import { legalVersionCovers } from "./legal-version";
import { z } from "./zod";

// The Telegram detail level of a member (ADR 0032 point 5): `full` is the message with its text and buttons, `minimal` is counts and
// panel links. The same two words as `noticeDetails`.
export const telegramDetailSchema = z.enum(["full", "minimal"]);
export type TelegramDetail = z.infer<typeof telegramDetailSchema>;

export const telegramStateSchema = z.object({
  available: z.boolean(),
  linked: z.boolean(),
  linkedAt: z.iso.datetime().nullable(),
  botUsername: z.string().nullable(),
  // The consent version of the session user that an unlink did not withdraw. null: no consent row, or the chat is not linked.
  // The panel asks for a new confirmation while `consentCovers(consentVersion, TELEGRAM_CONSENT_VERSION)` is false.
  consentVersion: z.string().nullable(),
  // With the flag `telegram_minimal` off for the organization none of the three keys is in the answer (the feature is off).
  // `detail`: the stored choice of the member. `effectiveDetail`: what Telegram gets now (the lock of the organization wins over `full`).
  // `locked`: the owner locked `minimal`; the stored choice stays for the unlock.
  detail: telegramDetailSchema.optional(),
  effectiveDetail: telegramDetailSchema.optional(),
  locked: z.boolean().optional(),
});
export type TelegramState = z.infer<typeof telegramStateSchema>;

export const telegramLinkSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type TelegramLink = z.infer<typeof telegramLinkSchema>;

// The date of the consent text in the panel (i18n keys tg_consent_*). A change of that text gets a new date:
// the server then refuses links made with the old text.
// The version format is the rule of `legal-version.ts`.
export const TELEGRAM_CONSENT_VERSION = "2026-11-19";
// The first version whose text names the open-loops data (recipients, the ask, the promise).
// A user whose newest consent is older gets no loop text in Telegram (consentCovers).
export const OPEN_LOOPS_CONSENT_SINCE = "2026-11-15.2";

// The first version whose text names the reply-draft data (the drafts that the AI writes, and the addresses of the other recipients of a
// mail: To, Cc, Reply-To). A user whose newest consent is older gets only the count of waiting replies and a panel
// link in Telegram, never a reply card (`consentCovers`). The consent text test in `apps/web/src/i18n/i18n.test.ts` fails when this
// version is offered while a consent text does not name reply data.
export const REPLY_CONSENT_SINCE = "2026-11-19";

// True when the consent `version` of a user is not older than `since`. A user with no consent row (null) is not covered.
// The version format and the order are the rule of `legal-version.ts`; an invalid version (either side) is not covered.
export function consentCovers(version: string | null, since: string): boolean {
  return legalVersionCovers(version, since);
}

// `detail` absent = the stored level stays (the column default is `minimal`); the flag `telegram_minimal` off ignores it, also a bad value. `full` needs the current consent text.
export const telegramLinkBodySchema = z.object({
  consentVersion: z.string().min(1).max(32),
  detail: telegramDetailSchema.optional(),
});
export type TelegramLinkBody = z.infer<typeof telegramLinkBodySchema>;

// PATCH /me/telegram-detail: `full` needs `consentVersion` = the current consent text (it records the consent); `minimal` needs none.
export const telegramDetailBodySchema = z.object({
  detail: telegramDetailSchema,
  consentVersion: z.string().min(1).max(32).optional(),
});
export type TelegramDetailBody = z.infer<typeof telegramDetailBodySchema>;

export const telegramDetailAnswerSchema = z.object({
  detail: telegramDetailSchema,
  effectiveDetail: telegramDetailSchema,
  locked: z.boolean(),
});
export type TelegramDetailAnswer = z.infer<typeof telegramDetailAnswerSchema>;

// PATCH /organization/telegram-lock (owner): lock `minimal` for every member, or lift the lock.
export const telegramLockBodySchema = z.object({ locked: z.boolean() });
export type TelegramLockBody = z.infer<typeof telegramLockBodySchema>;
export const telegramLockAnswerSchema = z.object({ locked: z.boolean() });
export type TelegramLockAnswer = z.infer<typeof telegramLockAnswerSchema>;

// The body and the answer of POST /telegram/consent: a linked user confirms the current consent text.
export const telegramConsentBodySchema = z.object({ version: z.string().min(1).max(32) });
export type TelegramConsentBody = z.infer<typeof telegramConsentBodySchema>;
export const telegramConsentSchema = z.object({ version: z.string().min(1).max(32) });
export type TelegramConsent = z.infer<typeof telegramConsentSchema>;
