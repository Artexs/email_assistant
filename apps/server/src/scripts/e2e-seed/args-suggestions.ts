import { greenMailAddress, type E2eProject } from "./args-core";

// One organization per project for the suggestions spec (`suggestions.spec.ts`). The flags `sender_context`, `sender_suggestions` and
// `sent_sync` are on; one mailbox with three open suggestions and Sent coverage (see `e2e-suggestion-rows.ts`; the spec resets them
// before each test with `e2e-suggestions.ts`). The patterns are the identity of the rows; the counts are the reason of each row. The
// order of the list is the newest first: `vip`, `blocklist`, `whitelist`.
export const E2E_SUGGESTIONS_OWNER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-suggestions-owner-mobile@x.test",
  desktop: "e2e-suggestions-owner-desktop@x.test",
};
export const E2E_SUGGESTIONS_MEMBER_EMAILS: Record<E2eProject, string> = {
  mobile: "e2e-suggestions-member-mobile@x.test",
  desktop: "e2e-suggestions-member-desktop@x.test",
};
export const e2eSuggestionsOrgName = (project: E2eProject): string => `E2E Suggestions ${project}`;
export const e2eSuggestionsMailbox = (project: E2eProject): string =>
  greenMailAddress(`e2e-suggestions-${project}@e2e.test`);
export const E2E_SUGGESTIONS = {
  vip: { pattern: "boss@client.test", kind: "vip", scope: "address", reason: { received: 8, answered: 6 } },
  blocklist: { pattern: "junk@spam.test", kind: "blocklist", scope: "address", reason: { corrected: 3 } },
  whitelist: { pattern: "@partner.test", kind: "whitelist", scope: "domain", reason: { rescued: 4, senders: 2 } },
} as const;
