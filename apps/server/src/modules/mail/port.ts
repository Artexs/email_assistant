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
  close(): Promise<void>;
}

/** Login failure: the job sets the mailbox to `auth_error`. */
export class MailAuthError extends HardError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MailAuthError";
  }
}
