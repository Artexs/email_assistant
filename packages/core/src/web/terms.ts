import { z } from "./zod";

export interface TermsHistoryEntry {
  /** The format and the parser are in `legal-version.ts`: new entries use `YYYY-MM-DD` or `YYYY-MM-DD.N`. The hyphen entries (`2026-11-18-2`) are the legacy spelling of the same counter. */
  version: string;
  /** SHA-256 of the legal texts and registries at this version (`legalTextsDigest` in `apps/web/src/lib/legal-checks.ts`); `null` for the stub era. */
  sha256: string | null;
}

// Append-only. The format is in `legal-version.ts`: new entries use the dot (`YYYY-MM-DD.2`). The two hyphen entries are the legacy
// spelling of `.2`; they stay as written because stored acceptance rows hold these strings. A change of a legal text (the six pages, the two registries, the `legal_*` keys, `tg_consent_text`) needs a
// new entry: the unit test `apps/web/src/lib/legal-version.test.ts` fails until the last digest matches the files. A new
// version makes every member accept the terms again at the next sign-in (the version guard of
// `apps/web/src/lib/legal-version.test.ts`).
export const TERMS_HISTORY: readonly TermsHistoryEntry[] = [
  { version: "2026-11-12", sha256: null }, // the stub era
  { version: "2026-11-17", sha256: "19879c6e6fec34e7eac3f75d873be45400dcc8c048e0b88dae19d6c28c5eec5a" },
  { version: "2026-11-18", sha256: "4c28889f8a7b2567b52b26b06c6be28b0cce5711298113425e32db6a2fd3673d" }, // data category sender-context
  { version: "2026-11-18-2", sha256: "8386c47db63b162fb771458b7e3c31ce09d07587ca588fc51ec730c95bd420d4" }, // data category push-devices
  { version: "2026-11-19", sha256: "0d28bb37aa989259d6f2660fc4a7fb1402418a5e8ffdb5d87938cf1c2f78df8d" }, // sub-processor web-push, Telegram levels
  { version: "2026-11-19-2", sha256: "b78d2c1c9e5c0f00422e21a2c4ce9ceb68b546676e1baed1408c405dd9a823fa" }, // reply drafts: consent text, privacy text, row openai
  { version: "2026-11-20", sha256: "6ed7e71ad979a4cc646faf90a6ecd170eadf1c6d20e0966c2dcf8132940aae67" }, // AI provider: thread context, history check
];

function lastVersion(history: readonly TermsHistoryEntry[]): string {
  const last = history[history.length - 1];
  if (last === undefined) throw new Error("TERMS_HISTORY is empty");
  return last.version;
}

export const TERMS_VERSION = lastVersion(TERMS_HISTORY);

export const termsAcceptBodySchema = z.object({ version: z.string().min(1).max(40) });
export type TermsAcceptBody = z.infer<typeof termsAcceptBodySchema>;
