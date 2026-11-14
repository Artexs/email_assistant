import { HardError } from "../../platform/errors";

export const INBOX = "INBOX";

/** The largest message that transferByAppend reads into memory. */
export const TRANSFER_MAX_BYTES = 25_000_000;
/** Flags that transferByAppend never copies (case-insensitive). */
export const TRANSFER_DROP_FLAGS = ["\\Recent", "\\Deleted", "$Junk", "Junk"] as const;

/** The flags that transferByAppend copies. */
export function transferFlags(flags: Iterable<string>): string[] {
  const drop = new Set(TRANSFER_DROP_FLAGS.map((flag) => flag.toLowerCase()));
  return [...flags].filter((flag) => !drop.has(flag.toLowerCase()));
}

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

export interface FolderStatus {
  uidValidity: number;
  /** The largest of STATUS UIDNEXT, SELECT UIDNEXT and highestUid + 1 (finite values only), at least 1. */
  uidNext: number;
  /** The UID of `*`; 0 when the folder is empty. */
  highestUid: number;
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

// What the capture keeps from one mail (F100 D2). Every adapter returns this shape.
export const CAPTURE_LIMITS = {
  fromName: 200,
  replyTo: 5,
  returnPath: 320,
  authResults: 1000,
  listUnsubscribe: 1000,
  listId: 300,
  autoSubmitted: 100,
  precedence: 50,
  attachments: 20,
  attachmentName: 200,
  attachmentType: 100,
  links: 50,
  host: 253,
} as const;

export interface CapturedAttachment {
  name: string | null;
  /** Lower case, e.g. "application/pdf". */
  type: string;
  /** Bytes, 0 or more. */
  size: number;
  /** Content disposition "inline", or a related part with a content id. */
  inline: boolean;
}

export interface CapturedLink {
  /** Lower case, no port, no trailing dot. */
  host: string;
  /** The host the visible link text shows, when the text is a URL or a bare host. */
  textHost: string | null;
}

export interface CapturedHeaders {
  fromName: string | null;
  /** Addresses, lower case, at most 5. */
  replyTo: string[];
  returnPath: string | null;
  /** The topmost Authentication-Results value. */
  authResults: string | null;
  listUnsubscribe: string | null;
  listId: string | null;
  /** A token: lower case, `^[a-z0-9-]{1,40}$`, else "other". */
  autoSubmitted: string | null;
  /** The same token rule. */
  precedence: string | null;
  hasCalendar: boolean;
  /** At most 20, in part order. */
  attachments: CapturedAttachment[];
  /** All parts, also past the 20. */
  attachmentCount: number;
  /** At most 50, first seen first, unique by (host, textHost). */
  links: CapturedLink[];
  /** Unique pairs before the cut. */
  linkCount: number;
  /** False: only the header block was read (attachments and links unknown). */
  partsKnown: boolean;
}

export interface MailContent {
  text: string | null;
  capture: CapturedHeaders | null;
}

export interface FlagsOfMessage {
  uid: number;
  flags: string[];
  /** The envelope Message-ID, as `MessageMeta.messageId`. */
  messageId: string | null;
  internalDate: Date;
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
  /** LIST only (no SELECT): path and delimiter of every folder. */
  listFolders(): Promise<{ path: string; delimiter: string }[]>;
  /** Throws MailFolderMissingError when the folder does not exist. */
  folderStatus(folder: string): Promise<FolderStatus>;
  /** UID FETCH lastUid+1:* in `folder`. Can also return uid <= lastUid (RFC 3501 `*` rule). [] for an empty folder. Throws MailFolderMissingError. */
  fetchAbove(folder: string, lastUid: number): Promise<MessageMeta[]>;
  /** Text and capture of one mail. Over the size limit: text null and the capture of the header block (`partsKnown` false).
   *  `{ text: null, capture: null }` when the UID is not in the folder or the source does not parse. Throws MailFolderMissingError. */
  fetchContent(folder: string, uid: number): Promise<MailContent>;
  /** IMAP flags of the given UIDs in `folder` with the identity of each mail (to check that a UID still names the same mail),
   *  ascending by uid; unknown UIDs are left out; [] for [] or a missing folder. */
  fetchFlagsIn(folder: string, uids: number[]): Promise<FlagsOfMessage[]>;
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
  /**
   * Moves one message by APPEND of its raw source to `toFolder` (flags without \Recent, \Deleted and the keywords $Junk and Junk, the same INTERNALDATE),
   * then \Deleted + UID EXPUNGE of the source. For a server that re-sorts a COPY into INBOX or a tab folder (Interia, F8, F12).
   * Throws MailNotFoundError when `uid` is not in `fromFolder` (also when the folder is missing); HardError("no UIDPLUS") before any write
   * when the server has no UIDPLUS; HardError("message too large to transfer") when RFC822.SIZE > TRANSFER_MAX_BYTES.
   * `newUid` = the APPENDUID; throws HardError("append gave no uid") when the server gives none.
   */
  transferByAppend(fromFolder: string, uid: number, toFolder: string): Promise<MoveResult>;
  /** `\Deleted` + UID EXPUNGE of one message. Throws HardError("no UIDPLUS") when the server has no UIDPLUS. Returns false when the UID is not there. */
  deleteMessage(folder: string, uid: number): Promise<boolean>;
  /** Adds and removes IMAP flags of one message. Throws MailNotFoundError when `uid` is not in `folder`. */
  setFlags(folder: string, uid: number, change: { add?: string[]; remove?: string[] }): Promise<void>;
  /** APPEND of a raw RFC 5322 message. `uid` is null when the message is stored but the server gives no APPENDUID; a skipped APPEND throws SoftError. Creates nothing: the caller runs ensureFolder first. */
  appendMessage(folder: string, raw: Buffer, flags: string[], internalDate: Date): Promise<{ uid: number | null }>;
  close(): Promise<void>;
}

/** Login failure: the job sets the mailbox to `auth_error`. */
export class MailAuthError extends HardError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MailAuthError";
  }
}

/** No mailbox with this id in the organization. */
export class MailboxNotFoundError extends HardError {
  constructor(options?: { cause?: unknown }) {
    super("mailbox not found", options);
    this.name = "MailboxNotFoundError";
  }
}

/** The organization has a mailbox with this address already. */
export class MailboxExistsError extends HardError {
  constructor(options?: { cause?: unknown }) {
    super("mailbox with this address already exists", options);
    this.name = "MailboxExistsError";
  }
}

/** The organization has `max` mailboxes already (any status). */
export class MailboxLimitError extends HardError {
  constructor(
    readonly max: number,
    options?: ErrorOptions
  ) {
    super("mailbox limit reached", options);
    this.name = "MailboxLimitError";
  }
}

/** The web refuses a local or private mail host (B12). */
export class HostNotAllowedError extends HardError {
  constructor(options?: { cause?: unknown }) {
    super("host not allowed", options);
    this.name = "HostNotAllowedError";
  }
}

/** The UID is not in the folder. */
export class MailNotFoundError extends HardError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MailNotFoundError";
  }
}

/** The folder is not on the server (any more). The message never holds the path. */
export class MailFolderMissingError extends HardError {
  constructor(options?: { cause?: unknown }) {
    super("IMAP folder not found", options);
    this.name = "MailFolderMissingError";
  }
}

export interface SendResult {
  response: string;
  accepted: string[];
  rejected: string[];
}

/** Where an SMTP send stopped. `content` and `unknown` mean the server may have the mail: no resend. */
export type SmtpStage = "connect" | "login" | "envelope" | "content" | "unknown";

export class SmtpSendError extends Error {
  override name = "SmtpSendError";

  constructor(
    readonly stage: SmtpStage,
    /** The nodemailer code: ECONNECTION, ETIMEDOUT, ESOCKET, EDNS, ETLS, EENVELOPE, EMESSAGE, EPROTOCOL, … */
    readonly code: string,
    readonly responseCode: number | null,
    /** A 5xx reply. */
    readonly permanent: boolean,
    /** A lost connection, a timeout, DNS, or a 4xx reply: the job may retry when the stage allows it. */
    readonly soft: boolean,
    options?: { cause?: unknown }
  ) {
    super(`SMTP send failed: stage ${stage}, code ${code}, response ${responseCode ?? "none"}`, options);
  }
}

export interface MailSender {
  /** Sends the raw message with the given envelope. The caller decides on a retry from `SmtpSendError.stage`. */
  send(input: { envelope: { from: string; to: string[] }; raw: Buffer }): Promise<SendResult>;
  close(): Promise<void>;
}
