// The header that marks a mail as the system's own: a draft or a send (value = an action id) or a report mail that the system appended
// (value = an outbox id). The one production spelling of the name (ADR 0022 point 2); `apps/server/src/action-id-header-scan.test.ts` keeps it so.
// Writers use `ACTION_ID_HEADER`; readers of lower-cased header maps and IMAP fetch lists use `ACTION_ID_HEADER_KEY`.
export const ACTION_ID_HEADER = "X-EA-Action-Id";
export const ACTION_ID_HEADER_KEY = "x-ea-action-id" satisfies Lowercase<typeof ACTION_ID_HEADER>;
