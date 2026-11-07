import {
  ImapFlow,
  type FetchMessageObject,
  type FetchQueryObject,
  type ImapFlowOptions,
  type MailboxLockObject,
} from "imapflow";

import { HardError, SoftError } from "../../../platform/errors";
import { createLog } from "../../../platform/log";
import {
  INBOX,
  MailAuthError,
  type FolderMessageMeta,
  type InboxStatus,
  type MailCapabilities,
  type MailProvider,
  type MailServerInfo,
  type MessageMeta,
  MailNotFoundError,
  type MoveResult,
} from "../port";

import { bodyTextFromSource, toFolderMessageMeta, toMessageMeta } from "./mapper";

const log = createLog("mail");

const DEFAULT_BODY_LIMIT_BYTES = 5_000_000;
const DEFAULT_CONNECTION_TIMEOUT_MS = 30_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
// Lost connection or timeout (imapflow uses ETIMEOUT, CONNECT_TIMEOUT, GREETING_TIMEOUT for its own timers).
const SOFT_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ENOTFOUND",
  "NoConnection",
  "ETIMEOUT",
  "CONNECT_TIMEOUT",
  "GREETING_TIMEOUT",
]);
const META_QUERY: FetchQueryObject = {
  uid: true,
  size: true,
  internalDate: true,
  envelope: true,
  headers: ["references", "x-ea-action-id"],
};
const FOLDER_META_QUERY: FetchQueryObject = { ...META_QUERY, flags: true };

export interface ImapConnectOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  secure?: boolean;
  bodyLimitBytes?: number;
  connectionTimeoutMs?: number;
  /** Ignore the MOVE capability and use COPY + UID EXPUNGE (the path of a server like Interia). */
  forceCopyMove?: boolean;
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

/** TLS certificates are always checked: this never sets `tls`, so no option can turn the check off. */
export function imapFlowOptions(opts: ImapConnectOptions): ImapFlowOptions {
  const secure = opts.secure ?? !isLoopbackHost(opts.host);
  if (!secure && !isLoopbackHost(opts.host)) {
    throw new HardError("plain IMAP is allowed only to a loopback host");
  }
  return {
    host: opts.host,
    port: opts.port,
    secure,
    auth: { user: opts.user, pass: opts.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: opts.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
    ...(secure ? {} : { doSTARTTLS: false }),
  };
}

/** Maps an imapflow or socket error to a typed error. The message never holds the password; the original is the `cause`. */
export function toMailError(error: unknown, action: string): Error {
  if (error instanceof SoftError || error instanceof HardError) return error;
  const fields = (typeof error === "object" && error !== null ? error : {}) as {
    authenticationFailed?: unknown;
    code?: unknown;
  };
  if (fields.authenticationFailed === true) {
    return new MailAuthError("IMAP login failed", { cause: error });
  }
  const code = typeof fields.code === "string" ? fields.code : null;
  if (code !== null && SOFT_CODES.has(code)) {
    return new SoftError(`IMAP ${action}: connection error ${code}`, { cause: error });
  }
  return new HardError(`IMAP ${action} failed${code === null ? "" : ` (${code})`}`, { cause: error });
}

async function guard<T>(action: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toMailError(error, action);
  }
}

/** Connects and logs in. Used by the provider and by `tools.ts`. */
export async function connectImapClient(opts: ImapConnectOptions): Promise<ImapFlow> {
  const client = new ImapFlow(imapFlowOptions(opts));
  // Without a listener, an "error" event would end the process.
  client.on("error", (error: Error) => {
    const { code } = error as { code?: unknown };
    log.warn("IMAP connection error", typeof code === "string" ? code : "unknown");
  });
  try {
    await client.connect();
  } catch (error) {
    client.close();
    throw toMailError(error, "connect");
  }
  return client;
}

function byUid(a: MessageMeta, b: MessageMeta): number {
  return a.uid - b.uid;
}

export interface FolderEntry {
  path: string;
  delimiter: string;
}

/** Returns the listed path of the folder `name` ("A/B"), or null. `prefix` is the personal namespace prefix of the server. */
export function matchFolder(entries: FolderEntry[], name: string, prefix: string): string | null {
  const wanted = name.split("/");
  for (const entry of entries) {
    if (entry.path === name) return entry.path;
    const rest = prefix !== "" && entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : entry.path;
    const parts = rest.split(entry.delimiter);
    if (parts.length === wanted.length && parts.every((part, index) => part === wanted[index])) return entry.path;
  }
  return null;
}

class ImapMailProvider implements MailProvider {
  constructor(
    private readonly client: ImapFlow,
    private readonly bodyLimitBytes: number,
    private readonly forceCopyMove: boolean
  ) {}

  private async withMailbox<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const lock = await this.client.getMailboxLock(path);
    try {
      return await fn();
    } finally {
      lock.release();
    }
  }

  private async fetchMetas(range: string): Promise<MessageMeta[]> {
    const raw: FetchMessageObject[] = [];
    for await (const msg of this.client.fetch(range, META_QUERY, { uid: true })) raw.push(msg);
    return raw.map(toMessageMeta).sort(byUid);
  }

  serverInfo(): Promise<MailServerInfo> {
    return guard("serverInfo", async () => {
      const caps = this.client.capabilities;
      const keywords = await this.withMailbox(INBOX, async () => {
        const box = this.client.mailbox;
        return box !== false && (box.permanentFlags?.has("\\*") ?? false);
      });
      const capabilities: MailCapabilities = {
        idle: caps.has("IDLE"),
        move: caps.has("MOVE"),
        uidplus: caps.has("UIDPLUS"),
        condstore: caps.has("CONDSTORE"),
        specialUse: caps.has("SPECIAL-USE"),
        keywords,
      };
      const folders = (await this.client.list()).map((entry) => ({
        path: entry.path,
        specialUse: entry.specialUse ?? null,
      }));
      return { capabilities, folders };
    });
  }

  inboxStatus(): Promise<InboxStatus> {
    return guard("inboxStatus", () =>
      this.withMailbox(INBOX, async () => {
        const box = this.client.mailbox;
        if (box === false) throw new HardError("IMAP INBOX is not open");
        const uidValidity = Number(box.uidValidity);
        if (!Number.isFinite(uidValidity)) throw new HardError("IMAP INBOX gave no valid UIDVALIDITY");
        // Interia sends no UIDNEXT on SELECT: ask with STATUS, then fall back to the highest UID + 1.
        let uidNext = box.uidNext;
        if (!Number.isFinite(uidNext)) {
          uidNext = (await this.client.status(INBOX, { uidNext: true })).uidNext as number;
        }
        if (!Number.isFinite(uidNext) && box.exists > 0) {
          const last = await this.client.fetchOne("*", { uid: true }, { uid: true });
          uidNext = last === false ? NaN : last.uid + 1;
        }
        if (!Number.isFinite(uidNext)) uidNext = 1;
        return { uidValidity, uidNext };
      })
    );
  }

  fetchAbove(lastUid: number): Promise<MessageMeta[]> {
    return guard("fetchAbove", () =>
      this.withMailbox(INBOX, async () => {
        const box = this.client.mailbox;
        // `n:*` on an empty mailbox is an invalid range for some servers.
        if (box === false || box.exists === 0) return [];
        return this.fetchMetas(`${lastUid + 1}:*`);
      })
    );
  }

  searchInboxSince(since: Date): Promise<number[]> {
    return guard("searchInboxSince", () =>
      this.withMailbox(INBOX, async () => {
        const uids = await this.client.search({ since }, { uid: true });
        return uids === false ? [] : uids;
      })
    );
  }

  fetchByUids(uids: number[]): Promise<MessageMeta[]> {
    if (uids.length === 0) return Promise.resolve([]);
    return guard("fetchByUids", () => this.withMailbox(INBOX, () => this.fetchMetas(uids.join(","))));
  }

  fetchBodyText(uid: number): Promise<string | null> {
    return guard("fetchBodyText", () =>
      this.withMailbox(INBOX, async () => {
        const head = await this.client.fetchOne(String(uid), { uid: true, size: true }, { uid: true });
        if (head === false || (head.size ?? 0) > this.bodyLimitBytes) return null;
        const full = await this.client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
        if (full === false || full.source === undefined) return null;
        return bodyTextFromSource(full.source);
      })
    );
  }

  findByMessageId(folder: string, messageId: string): Promise<number | null> {
    return guard("findByMessageId", async () => {
      let lock: MailboxLockObject;
      try {
        lock = await this.client.getMailboxLock(folder);
      } catch (error) {
        if (toMailError(error, "select") instanceof SoftError) throw error;
        // SELECT failed: a missing folder gives null, any other failure is an error.
        const exists = (await this.client.list()).some((entry) => entry.path === folder);
        if (exists) throw error;
        return null;
      }
      try {
        const uids = await this.client.search({ header: { "message-id": messageId } }, { uid: true });
        return uids === false ? null : (uids[0] ?? null);
      } finally {
        lock.release();
      }
    });
  }

  /** Locks `folder`; null when the folder does not exist, any other SELECT error throws. */
  private async lockOrNull(folder: string): Promise<MailboxLockObject | null> {
    try {
      return await this.client.getMailboxLock(folder);
    } catch (error) {
      if (toMailError(error, "select") instanceof SoftError) throw error;
      const exists = (await this.client.list()).some((entry) => entry.path === folder);
      if (exists) throw error;
      return null;
    }
  }

  private async withFolder<T>(folder: string, fallback: T, fn: () => Promise<T>): Promise<T> {
    const lock = await this.lockOrNull(folder);
    if (lock === null) return fallback;
    try {
      return await fn();
    } finally {
      lock.release();
    }
  }

  private async fetchFolderMetas(range: string): Promise<FolderMessageMeta[]> {
    const raw: FetchMessageObject[] = [];
    for await (const msg of this.client.fetch(range, FOLDER_META_QUERY, { uid: true })) raw.push(msg);
    return raw.map(toFolderMessageMeta).sort(byUid);
  }

  /** Inside a lock: whether `uid` is in the open folder. */
  private async hasUid(uid: number): Promise<boolean> {
    const msg = await this.client.fetchOne(String(uid), { uid: true }, { uid: true });
    return msg !== false && msg.uid === uid;
  }

  private async listFolders(): Promise<FolderEntry[]> {
    return (await this.client.list()).map((entry) => ({ path: entry.path, delimiter: entry.delimiter }));
  }

  ensureFolder(name: string): Promise<string> {
    return guard("ensureFolder", async () => {
      // `namespace` exists at run time but not in the imapflow typings.
      const prefix = (this.client as unknown as { namespace?: { prefix?: string } }).namespace?.prefix ?? "";
      const found = matchFolder(await this.listFolders(), name, prefix);
      if (found !== null) return found;
      // Parent first: Interia refuses a nested CREATE while the parent is missing.
      const parts = name.split("/");
      for (let depth = 1; depth <= parts.length; depth++) {
        const level = parts.slice(0, depth);
        if (matchFolder(await this.listFolders(), level.join("/"), prefix) === null) {
          await this.client.mailboxCreate(level);
        }
      }
      const created = matchFolder(await this.listFolders(), name, prefix);
      if (created === null) throw new HardError("folder create failed");
      return created;
    });
  }

  fetchMetaIn(folder: string, uid: number): Promise<FolderMessageMeta | null> {
    return guard("fetchMetaIn", () =>
      this.withFolder<FolderMessageMeta | null>(folder, null, async () => {
        const msg = await this.client.fetchOne(String(uid), FOLDER_META_QUERY, { uid: true });
        // A single UID that is not in the folder gives false; still keep only the asked UID.
        return msg === false || msg.uid !== uid ? null : toFolderMessageMeta(msg);
      })
    );
  }

  searchSinceIn(folder: string, since: Date): Promise<number[]> {
    return guard("searchSinceIn", () =>
      this.withFolder<number[]>(folder, [], async () => {
        const uids = await this.client.search({ since }, { uid: true });
        return uids === false ? [] : uids;
      })
    );
  }

  fetchByUidsIn(folder: string, uids: number[]): Promise<FolderMessageMeta[]> {
    if (uids.length === 0) return Promise.resolve([]);
    const asked = new Set(uids);
    return guard("fetchByUidsIn", () =>
      this.withFolder<FolderMessageMeta[]>(folder, [], async () =>
        (await this.fetchFolderMetas(uids.join(","))).filter((meta) => asked.has(meta.uid))
      )
    );
  }

  moveMessage(fromFolder: string, uid: number, toFolder: string): Promise<MoveResult> {
    return guard("moveMessage", async () => {
      const lock = await this.lockOrNull(fromFolder);
      if (lock === null) throw new MailNotFoundError("mail not found");
      try {
        if (!(await this.hasUid(uid))) throw new MailNotFoundError("mail not found");
        // imapflow's own MOVE fallback deletes the source also when the COPY failed: never use it.
        if (this.client.capabilities.has("MOVE") && !this.forceCopyMove) {
          const moved = await this.client.messageMove(String(uid), toFolder, { uid: true });
          if (!moved) throw new HardError("move refused");
          return { newUid: moved.uidMap?.get(uid) ?? null };
        }
        if (!this.client.capabilities.has("UIDPLUS")) throw new HardError("no UIDPLUS");
        const copied = await this.client.messageCopy(String(uid), toFolder, { uid: true });
        if (!copied) throw new HardError("copy refused");
        // COPY first, EXPUNGE last: a crash in between leaves two copies, never none.
        const deleted = await this.client.messageDelete(String(uid), { uid: true });
        if (!deleted || (await this.hasUid(uid))) throw new HardError("expunge refused");
        return { newUid: copied.uidMap?.get(uid) ?? null };
      } finally {
        lock.release();
      }
    });
  }

  deleteMessage(folder: string, uid: number): Promise<boolean> {
    return guard("deleteMessage", async () => {
      if (!this.client.capabilities.has("UIDPLUS")) throw new HardError("no UIDPLUS");
      return this.withFolder<boolean>(folder, false, async () => {
        if (!(await this.hasUid(uid))) return false;
        // messageDelete sets \Deleted itself and sends UID EXPUNGE.
        const deleted = await this.client.messageDelete(String(uid), { uid: true });
        if (!deleted || (await this.hasUid(uid))) throw new HardError("expunge refused");
        return true;
      });
    });
  }

  setFlags(folder: string, uid: number, change: { add?: string[]; remove?: string[] }): Promise<void> {
    return guard("setFlags", async () => {
      const lock = await this.lockOrNull(folder);
      if (lock === null) throw new MailNotFoundError("mail not found");
      try {
        if (!(await this.hasUid(uid))) throw new MailNotFoundError("mail not found");
        const add = change.add ?? [];
        const remove = change.remove ?? [];
        if (add.length > 0 && !(await this.client.messageFlagsAdd(String(uid), add, { uid: true }))) {
          throw new HardError("flag store refused");
        }
        if (remove.length > 0 && !(await this.client.messageFlagsRemove(String(uid), remove, { uid: true }))) {
          throw new HardError("flag store refused");
        }
      } finally {
        lock.release();
      }
    });
  }

  async close(): Promise<void> {
    try {
      await this.client.logout();
    } catch {
      this.client.close();
    }
  }
}

export function createImapMailProvider(
  client: ImapFlow,
  opts: { bodyLimitBytes: number; forceCopyMove: boolean }
): MailProvider {
  return new ImapMailProvider(client, opts.bodyLimitBytes, opts.forceCopyMove);
}

export async function openImapProvider(opts: ImapConnectOptions): Promise<MailProvider> {
  const client = await connectImapClient(opts);
  return createImapMailProvider(client, {
    bodyLimitBytes: opts.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES,
    forceCopyMove: opts.forceCopyMove ?? false,
  });
}
