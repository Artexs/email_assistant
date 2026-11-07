export { checkMailbox, type CheckDeps, type CheckOptions, type CheckReport } from "./check";
export { buildFolderMap, connectMailbox, updateMailboxPassword, type ConnectDeps, type ConnectInput } from "./connect";
export { compareInboxWithDb, type AuditCounts, type InboxKey } from "./audit";
export { createMailSyncJob, type MailSyncJobDeps } from "./jobs";
export { openImapProvider, type ImapConnectOptions } from "./imap/client";
export { assertTestAddress, probeMove, type ProbeMoveReport } from "./imap/probe-move";
export { verifySmtpLogin, type SmtpConnectOptions } from "./imap/smtp";
export {
  INBOX,
  MailAuthError,
  MailNotFoundError,
  type FolderMessageMeta,
  type InboxStatus,
  type MailCapabilities,
  type MailFolder,
  type MailProvider,
  type MailServerInfo,
  type MessageMeta,
  type MoveResult,
} from "./port";
export {
  changeMailboxStatus,
  claimEmails,
  countWaiting,
  finishEmail,
  forceRescan,
  getMailbox,
  listFolderUids,
  listMailboxes,
  listSyncTargets,
  listThreadContext,
  mailKindFilter,
  releaseEmail,
  requeueTooOld,
} from "./repo";
export type { MailKind } from "./repo";
export type { ClaimedEmail, Cursor, MailboxRow, MailboxStatus, MailboxSummary, NewEmail } from "./repo";
export {
  isSyntheticMessageId,
  renderSeedMessage,
  SYNTHETIC_MESSAGE_ID_DOMAIN,
  SYNTHETIC_MESSAGE_ID_LIKE,
  type SeedMessage,
} from "./seed";
export { backfillInbox, CursorMovedError, syncMailbox, type SyncDeps, type SyncResult } from "./sync";
export { auditMailbox, backfillMailbox, seedMailbox, type ToolDeps } from "./tools";
export { locateKeyOf, locateMessage, LOCATE_CHUNK, type LocateKey } from "./locate";
export { IDENTITY_MODE, isDeleted, sameMailIdentity, type IdentityMode, type MailIdentity } from "./sync-rules";
