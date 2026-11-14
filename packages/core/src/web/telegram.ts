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
export const TELEGRAM_CONSENT_VERSION = "2026-11-14";
export const telegramLinkBodySchema = z.object({ consentVersion: z.string().min(1).max(32) });
export type TelegramLinkBody = z.infer<typeof telegramLinkBodySchema>;
