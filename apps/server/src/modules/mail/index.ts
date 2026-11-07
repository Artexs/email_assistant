export { checkMailbox, type CheckDeps, type CheckOptions, type CheckReport } from "./check";
export { buildFolderMap, connectMailbox, updateMailboxPassword, type ConnectDeps, type ConnectInput } from "./connect";
export { compareInboxWithDb, type AuditCounts, type InboxKey } from "./audit";
export { openMailboxProvider, type OpenDeps } from "./open";
export { createMailSyncJob, type MailSyncJobDeps } from "./jobs";
export { openImapProvider, type ImapConnectOptions } from "./imap/client";
export { assertTestAddress, probeMove, type ProbeMoveReport } from "./imap/probe-move";
export { composeMessage } from "./imap/compose";
export { openSmtpSender, verifySmtpLogin, type SmtpConnectOptions } from "./imap/smtp";
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
  type SendResult,
  type SmtpStage,
  SmtpSendError,
  type MailSender,
} from "./port";
export {
  changeMailboxStatus,
  claimEmails,
  clearReturned,
  countWaiting,
  finishEmail,
  forceRescan,
  getEmailMailbox,
  getEmailMeta,
  getMailbox,
  listFolderUids,
  listMailboxes,
  listReturned,
  listSyncTargets,
  listThreadContext,
  mailboxHasUidplus,
  mailKindFilter,
  releaseEmail,
  setMailboxStatus,
  requeueTooOld,
  setFolderMapEntry,
  setUndoPending,
  updateEmailLocation,
} from "./repo";
export type { EmailMeta, MailKind } from "./repo";
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
export {
  IDENTITY_MODE,
  isDeleted,
  normalizeMessageId,
  sameMailIdentity,
  type IdentityMode,
  type MailIdentity,
} from "./sync-rules";
