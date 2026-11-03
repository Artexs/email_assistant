export { checkMailbox, type CheckDeps, type CheckOptions, type CheckReport } from "./check";
export { buildFolderMap, connectMailbox, type ConnectDeps, type ConnectInput } from "./connect";
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
export type { Cursor, MailboxRow, NewEmail } from "./repo";
export { renderSeedMessage, type SeedMessage } from "./seed";
export { CursorMovedError, syncMailbox, type SyncDeps, type SyncResult } from "./sync";
