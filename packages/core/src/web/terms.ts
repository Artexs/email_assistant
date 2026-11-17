import { z } from "./zod";

export interface TermsHistoryEntry {
  /** `YYYY-MM-DD` (UTC date of the change), `-2`, `-3`, … for a second change on the same day. */
  version: string;
  /** SHA-256 of the legal texts and registries at this version (`legalTextsDigest` in `apps/web/src/lib/legal-checks.ts`); `null` for the stub era. */
  sha256: string | null;
}

// Append-only. A change of a legal text (the six pages, the two registries, the `legal_*` keys, `tg_consent_text`) needs a
// new entry: the unit test `apps/web/src/lib/legal-version.test.ts` fails until the last digest matches the files. A new
// version makes every member accept the terms again at the next sign-in (the version guard of
// `spec/features/active/F107-e7-t4-papers-and-cost/plan.md`).
export const TERMS_HISTORY: readonly TermsHistoryEntry[] = [
  { version: "2026-11-12", sha256: null }, // the stub era
  { version: "2026-11-17", sha256: "03ba1a09694fe82ccfe18190b893a71ff96f7f791fa26312a2f514710d8b4ec9" },
];

function lastVersion(history: readonly TermsHistoryEntry[]): string {
  const last = history[history.length - 1];
  if (last === undefined) throw new Error("TERMS_HISTORY is empty");
  return last.version;
}

export const TERMS_VERSION = lastVersion(TERMS_HISTORY);

export const termsAcceptBodySchema = z.object({ version: z.string().min(1).max(40) });
export type TermsAcceptBody = z.infer<typeof termsAcceptBodySchema>;
