import { z } from "./zod";

export const telegramStateSchema = z.object({
  available: z.boolean(),
  linked: z.boolean(),
  linkedAt: z.iso.datetime().nullable(),
  botUsername: z.string().nullable(),
});
export type TelegramState = z.infer<typeof telegramStateSchema>;

export const telegramLinkSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type TelegramLink = z.infer<typeof telegramLinkSchema>;

// The date of the consent text in the panel (i18n keys tg_consent_*). A change of that text gets a new date:
// the server then refuses links made with the old text.
// Versions are ISO dates; a second bump on the same day adds ".2", ".3" (they sort after the bare date and before the next day).
export const TELEGRAM_CONSENT_VERSION = "2026-11-15.2";
// The first version whose text names the open-loops data (recipients, the ask, the promise). F116 stage 17.
// A user whose newest consent is older gets no loop text in Telegram (consentCovers).
export const OPEN_LOOPS_CONSENT_SINCE = "2026-11-15.2";

// True when the consent `version` of a user is not older than `since`. A user with no consent row (null) is not covered.
// String order is date order because both sides are ISO dates with an optional ".N" suffix.
export function consentCovers(version: string | null, since: string): boolean {
  return version !== null && version >= since;
}
export const telegramLinkBodySchema = z.object({ consentVersion: z.string().min(1).max(32) });
export type TelegramLinkBody = z.infer<typeof telegramLinkBodySchema>;

// The body and the answer of POST /telegram/consent: a linked user confirms the current consent text.
export const telegramConsentBodySchema = z.object({ version: z.string().min(1).max(32) });
export type TelegramConsentBody = z.infer<typeof telegramConsentBodySchema>;
export const telegramConsentSchema = z.object({ version: z.string().min(1).max(32) });
export type TelegramConsent = z.infer<typeof telegramConsentSchema>;
