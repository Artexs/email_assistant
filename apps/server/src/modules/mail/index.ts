export { checkMailbox, type CheckDeps, type CheckOptions, type CheckReport } from "./check";
export {
  buildFolderMap,
  connectMailbox,
  updateMailboxPassword,
  type ConnectDeps,
  type ConnectInput,
  type ConnectMeta,
} from "./connect";
export { connectMailboxRequest } from "./connect-request";
export { isLocalMailHost } from "./host-check";
export { removeMailbox, type RemoveDeps, type RemoveResult } from "./remove";
export { mailErrorBody, mailRoutes, WEB_MAIL_TIMEOUTS, type MailRouteDeps } from "./routes";
export { getMailboxView, listMailboxViews } from "./views";
export { switchMailboxStatus, type SwitchResult } from "./status";
export { ensureSyncFolders, setSyncFolderEnabled, type SyncFolderSwitchResult } from "./folders";
export { auditExitCode, compareFolderWithDb, compareInboxWithDb, type AuditCounts, type InboxKey } from "./audit";
export { openMailboxProvider, type OpenDeps } from "./open";
export { createMailSyncJob, type MailSyncJobDeps } from "./jobs";
export { openImapProvider, type ImapConnectOptions } from "./imap/client";
export { assertTestAddress, probeMove, type ProbeMoveReport } from "./imap/probe-move";
export { isAllowedRecipient, probeSend, type ProbeSendReport } from "./imap/probe-send";
export { composeMessage } from "./imap/compose";
export { openSmtpSender, verifySmtpLogin, type SmtpConnectOptions } from "./imap/smtp";
export {
  INBOX,
  HostNotAllowedError,
  MailAuthError,
  MailboxExistsError,
  MailboxNotFoundError,
  MailFolderMissingError,
  MailNotFoundError,
  type FolderMessageMeta,
  type FolderStatus,
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
  getJunkFolderPath,
  getMailbox,
  getMailboxSummary,
  listEmailsByMessageIds,
  listFolderUids,
  listMailboxes,
  listMailboxTargets,
  listReturned,
  listSyncFolders,
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
export type { ClaimedEmail, Cursor, MailboxRow, MailboxStatus, MailboxSummary, NewEmail, SyncFolderRow } from "./repo";
export {
  isSyntheticMessageId,
  renderSeedMessage,
  SYNTHETIC_MESSAGE_ID_DOMAIN,
  SYNTHETIC_MESSAGE_ID_LIKE,
  type SeedMessage,
} from "./seed";
export {
  backfillInbox,
  CursorMovedError,
  syncMailbox,
  type MailboxSyncResult,
  type SyncDeps,
  type SyncResult,
} from "./sync";
export {
  auditMailbox,
  backfillMailbox,
  deliverTestMail,
  seedMailbox,
  type DeliverDeps,
  type DeliverInput,
  type ToolDeps,
} from "./tools";
export {
  locateByActionId,
  locateKeyOf,
  locateMessage,
  LOCATE_CHUNK,
  LOCATE_NEWEST_FIRST_CHUNK,
  type ActionLocateKey,
  type LocateKey,
} from "./locate";
export {
  IDENTITY_MODE,
  isDeleted,
  normalizeMessageId,
  sameMailIdentity,
  type IdentityMode,
  type MailIdentity,
} from "./sync-rules";
