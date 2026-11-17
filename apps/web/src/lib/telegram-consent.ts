import { consentCovers, TELEGRAM_CONSENT_VERSION, type TelegramState } from "@ea/core/web";

// The "New Telegram terms: open loops" block (F116 stage 22). It shows for a linked user whose consent is older than the current
// text, while the flag `open_loops` is on: the loop lines in Telegram need the new consent. An unlink withdraws a consent, and the
// server then reports `consentVersion: null`, so a user linked again by the CLI sees the block too (review 17, N4).
export function needsNewTerms(
  state: Pick<TelegramState, "linked" | "consentVersion">,
  features: readonly string[]
): boolean {
  return (
    state.linked && features.includes("open_loops") && !consentCovers(state.consentVersion, TELEGRAM_CONSENT_VERSION)
  );
}
