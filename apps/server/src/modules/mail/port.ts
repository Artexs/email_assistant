import { HardError } from "../../platform/errors";

export const INBOX = "INBOX";

export interface MailCapabilities {
  idle: boolean;
  move: boolean;
  uidplus: boolean;
  condstore: boolean;
  specialUse: boolean;
  keywords: boolean;
}

/** `specialUse` like "\\Drafts". */
export interface MailFolder {
  path: string;
  specialUse: string | null;
}

export interface MailServerInfo {
  capabilities: MailCapabilities;
  folders: MailFolder[];
}

export interface InboxStatus {
  uidValidity: number;
  uidNext: number;
}

export interface MessageMeta {
  uid: number;
  size: number;
  internalDate: Date;
  date: Date | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string | null;
  to: string[];
  cc: string[];
  subject: string | null;
  /** Header X-EA-Action-Id. */
  actionId: string | null;
}

export interface FolderMessageMeta extends MessageMeta {
  /** IMAP flags of the message, e.g. "\\Seen", "\\Flagged". */
  flags: string[];
}

export interface MoveResult {
  /** The UID in the target folder when the server reports it (COPYUID / MOVE with UIDPLUS); else null. */
  newUid: number | null;
}

export interface MailProvider {
  serverInfo(): Promise<MailServerInfo>;
  inboxStatus(): Promise<InboxStatus>;
  /** UID FETCH lastUid+1:* in INBOX. Can also return uid <= lastUid (RFC 3501 `*` rule). */
  fetchAbove(lastUid: number): Promise<MessageMeta[]>;
  /** UIDs in INBOX with INTERNALDATE on or after the day of `since`. */
  searchInboxSince(since: Date): Promise<number[]>;
  /** INBOX. */
  fetchByUids(uids: number[]): Promise<MessageMeta[]>;
  /** INBOX. Null when larger than the size limit or no text. */
  fetchBodyText(uid: number): Promise<string | null>;
  /** Null also when the folder does not exist. */
  findByMessageId(folder: string, messageId: string): Promise<number | null>;
  /** Creates the folder when it is missing. Returns the path as the server lists it. */
  ensureFolder(name: string): Promise<string>;
  /** Null when the folder has no such UID (also when the folder does not exist). */
  fetchMetaIn(folder: string, uid: number): Promise<FolderMessageMeta | null>;
  /** UIDs in `folder` with INTERNALDATE on or after the day of `since`; [] when the folder does not exist. */
  searchSinceIn(folder: string, since: Date): Promise<number[]>;
  /** Metas of the given UIDs in `folder`, ascending; unknown UIDs are left out. */
  fetchByUidsIn(folder: string, uids: number[]): Promise<FolderMessageMeta[]>;
  /** Moves one message. Throws MailNotFoundError when `uid` is not in `fromFolder`. */
  moveMessage(fromFolder: string, uid: number, toFolder: string): Promise<MoveResult>;
  /** `\Deleted` + UID EXPUNGE of one message. Throws HardError("no UIDPLUS") when the server has no UIDPLUS. Returns false when the UID is not there. */
  deleteMessage(folder: string, uid: number): Promise<boolean>;
  /** Adds and removes IMAP flags of one message. Throws MailNotFoundError when `uid` is not in `folder`. */
  setFlags(folder: string, uid: number, change: { add?: string[]; remove?: string[] }): Promise<void>;
  close(): Promise<void>;
}

/** Login failure: the job sets the mailbox to `auth_error`. */
export class MailAuthError extends HardError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MailAuthError";
  }
}

/** The UID is not in the folder. */
export class MailNotFoundError extends HardError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MailNotFoundError";
  }
}
