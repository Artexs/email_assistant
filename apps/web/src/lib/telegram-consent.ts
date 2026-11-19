import { consentCovers, REPLY_CONSENT_SINCE, TELEGRAM_CONSENT_VERSION, type TelegramState } from "@ea/core/web";

// The "New Telegram terms" block. It shows for a linked user whose consent is older than the text that a data kind needs, while
// the flag of that kind is on: the flag `open_loops` needs the current consent text (loop lines in Telegram), the flag `reply_drafts`
// needs `REPLY_CONSENT_SINCE` (reply cards and the addresses of other recipients). An unlink withdraws a consent, and the server
// then reports `consentVersion: null`, so a user linked again by the CLI sees the block too.
export function needsNewTerms(
  state: Pick<TelegramState, "linked" | "consentVersion">,
  features: readonly string[]
): boolean {
  if (!state.linked) return false;
  const loops = features.includes("open_loops") && !consentCovers(state.consentVersion, TELEGRAM_CONSENT_VERSION);
  const replies = features.includes("reply_drafts") && !consentCovers(state.consentVersion, REPLY_CONSENT_SINCE);
  return loops || replies;
}
