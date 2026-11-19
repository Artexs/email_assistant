export { PROFILE_DAYS, readSenderActivity, type ReadActivityOptions, type SenderActivity } from "./activity";
export { normalizedAddress } from "./address-sql";
export { SENT_COVERAGE_FRESH_MS, sentCoverage, senderFlags, type SenderFlags } from "./flags";
export {
  createContactsRefreshJob,
  type ContactsRefreshJob,
  type ContactsRefreshJobDeps,
  type ContactsRefreshResult,
} from "./jobs";
export {
  deleteEndedSuggestions,
  deleteOldProfiles,
  deleteSenderContextRowsOf,
  lockProfilesOfOrg,
  senderAddressesOfProfiles,
  senderContextRowsOf,
  type SenderContextRows,
} from "./privacy";
export { readSenderLines, senderLineOf, type SenderLineDeps, type SenderMail } from "./lines";
export { readProfiles } from "./profiles";
export {
  acceptSuggestion,
  countOpenSuggestions,
  dismissSuggestion,
  listOpenSuggestions,
  type AcceptResult,
  type DismissResult,
  type OpenSuggestion,
  type SuggestionCommand,
  type SuggestionDeps,
  type SuggestionVia,
} from "./suggestion-commands";
export { rulePatternOf, SUGGESTION_DISMISS_DAYS, SUGGESTION_OPEN_DAYS } from "./suggest";
export {
  profileLockKey,
  refreshMailboxProfiles,
  tryLockProfiles,
  type RefreshDeps,
  type RefreshResult,
} from "./refresh";
export { contactWaitFor, type ContactWait } from "./wait";
