import { z } from "./zod";

export const telegramStateSchema = z.object({
  available: z.boolean(),
  linked: z.boolean(),
  linkedAt: z.iso.datetime().nullable(),
  botUsername: z.string().nullable(),
  // The consent version of the session user that an unlink did not withdraw. null: no consent row, or the chat is not linked.
  // The panel asks for a new confirmation while `consentCovers(consentVersion, TELEGRAM_CONSENT_VERSION)` is false.
  consentVersion: z.string().nullable(),
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
// The first version whose text names the open-loops data (recipients, the ask, the promise).
// A user whose newest consent is older gets no loop text in Telegram (consentCovers).
export const OPEN_LOOPS_CONSENT_SINCE = "2026-11-15.2";

// The first version whose text names the reply-draft data (the drafts that the AI writes, and the addresses of the other recipients of a
// mail: To, Cc, Reply-To). A user whose newest consent is older gets only the count of waiting replies and a panel
// link in Telegram, never a reply card (`consentCovers`).
// PLACEHOLDER, deliberately ABOVE `TELEGRAM_CONSENT_VERSION`: the consent text `tg_consent_text` is a legal text (the digest of
// `legal-version.test.ts` covers it), and a change of it needs a `TERMS_VERSION` bump, which belongs to the next legal text batch.
// Until then no consent text names reply data, so no user is covered and no reply card goes out. The next legal text batch changes the text, bumps
// `TELEGRAM_CONSENT_VERSION` and `TERMS_VERSION`, and sets this constant to the new `TELEGRAM_CONSENT_VERSION` in one commit.
export const REPLY_CONSENT_SINCE = "2099-12-31";

// True when the consent `version` of a user is not older than `since`. A user with no consent row (null) is not covered.
// The date part compares as text, the ".N" suffix as a number; an invalid version (either side) is not covered.
export function consentCovers(version: string | null, since: string): boolean {
  const have = parseConsentVersion(version);
  const need = parseConsentVersion(since);
  if (have === null || need === null) return false;
  if (have.date !== need.date) return have.date > need.date;
  return have.suffix >= need.suffix;
}

// A valid version is `YYYY-MM-DD` or `YYYY-MM-DD.N`; no suffix is 0. Anything else (garbage, empty) is not a version.
const CONSENT_VERSION = /^(\d{4}-\d{2}-\d{2})(?:\.(\d+))?$/;
function parseConsentVersion(version: string | null): { date: string; suffix: number } | null {
  const match = version === null ? null : CONSENT_VERSION.exec(version);
  if (!match?.[1]) return null;
  return { date: match[1], suffix: match[2] === undefined ? 0 : Number(match[2]) };
}
export const telegramLinkBodySchema = z.object({ consentVersion: z.string().min(1).max(32) });
export type TelegramLinkBody = z.infer<typeof telegramLinkBodySchema>;

// The body and the answer of POST /telegram/consent: a linked user confirms the current consent text.
export const telegramConsentBodySchema = z.object({ version: z.string().min(1).max(32) });
export type TelegramConsentBody = z.infer<typeof telegramConsentBodySchema>;
export const telegramConsentSchema = z.object({ version: z.string().min(1).max(32) });
export type TelegramConsent = z.infer<typeof telegramConsentSchema>;
