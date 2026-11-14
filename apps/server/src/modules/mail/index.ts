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
export { isLocalAddress, isLocalMailHost } from "./host-check";
export { configureMailHosts, mailHostPolicy, resolveMailHost, type LookupAll, type MailTarget } from "./host-guard";
export { removeMailbox, type RemoveDeps, type RemoveResult } from "./remove";
export { mailErrorBody, mailRoutes, WEB_MAIL_TIMEOUTS, type MailRouteDeps } from "./routes";
export { getMailboxView, listMailboxViews } from "./views";
export { switchMailboxStatus, type SwitchResult } from "./status";
export { ensureSyncFolders, setSyncFolderEnabled, type SyncFolderSwitchResult } from "./folders";
export { auditExitCode, compareFolderWithDb, compareInboxWithDb, type AuditCounts, type InboxKey } from "./audit";
export { openMailboxProvider, type OpenDeps } from "./open";
export { createMailSyncJob, type MailSyncJobDeps } from "./jobs";
export { FLAGS_CHUNK, FLAGS_REFRESH_EVERY_MS, FLAGS_RUN_LIMIT, FLAGS_WINDOW_MS, refreshFlags } from "./flags";
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
  MailboxLimitError,
  MailboxNotFoundError,
  MailFolderMissingError,
  MailNotFoundError,
  CAPTURE_LIMITS,
  type CapturedAttachment,
  type CapturedHeaders,
  type CapturedLink,
  type FolderMessageMeta,
  type FolderStatus,
  type MailContent,
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
  clearMailBodies,
  PENDING_BODY_DAYS,
  clearMailHeaders,
  clearReturned,
  clearCapturedHeaders,
  countSyncTargets,
  countWaiting,
  finishEmail,
  forceRescan,
  getEmailFlags,
  getEmailHeaders,
  getEmailMailbox,
  getEmailMeta,
  getJunkFolderPath,
  getMailbox,
  getMailboxSummary,
  insertEmailHeaders,
  listAuthErrorMailboxesBefore,
  listEmailsByMessageIds,
  listFlagTargets,
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
  writeEmailFlags,
} from "./repo";
export type { EmailFlagsRow, EmailHeadersRow, FlagRead, FlagTarget, EmailMeta, MailKind } from "./repo";
export type { ClaimedEmail, Cursor, MailboxRow, MailboxStatus, MailboxSummary, NewEmail, SyncFolderRow } from "./repo";
export {
  isSyntheticMessageId,
  isTestMail,
  NO_TEST_SENDERS,
  renderSeedMessage,
  SYNTHETIC_MESSAGE_ID_DOMAIN,
  SYNTHETIC_MESSAGE_ID_LIKE,
  type SeedMessage,
  type TestMailRule,
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
  signalsOfMailbox,
  SIGNALS_CONTENT_LIMIT,
  type MailboxSignals,
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
