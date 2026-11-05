export { checkMailbox, type CheckDeps, type CheckOptions, type CheckReport } from "./check";
export { buildFolderMap, connectMailbox, type ConnectDeps, type ConnectInput } from "./connect";
export { compareInboxWithDb, type AuditCounts, type InboxKey } from "./audit";
export { createMailSyncJob, type MailSyncJobDeps } from "./jobs";
export { openImapProvider, type ImapConnectOptions } from "./imap/client";
export { verifySmtpLogin, type SmtpConnectOptions } from "./imap/smtp";
export {
  INBOX,
  MailAuthError,
  type InboxStatus,
  type MailCapabilities,
  type MailFolder,
  type MailProvider,
  type MailServerInfo,
  type MessageMeta,
} from "./port";
export {
  claimEmails,
  finishEmail,
  forceRescan,
  getMailbox,
  listSyncTargets,
  listThreadContext,
  mailKindFilter,
  releaseEmail,
  requeueTooOld,
} from "./repo";
export type { MailKind } from "./repo";
export type { ClaimedEmail, Cursor, MailboxRow, NewEmail } from "./repo";
export {
  isSyntheticMessageId,
  renderSeedMessage,
  SYNTHETIC_MESSAGE_ID_DOMAIN,
  SYNTHETIC_MESSAGE_ID_LIKE,
  type SeedMessage,
} from "./seed";
export { backfillInbox, CursorMovedError, syncMailbox, type SyncDeps, type SyncResult } from "./sync";
export { auditMailbox, backfillMailbox, seedMailbox, type ToolDeps } from "./tools";
