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
  type InboxStatus,
  type MailCapabilities,
  type MailProvider,
  type MailServerInfo,
  type MessageMeta,
} from "../port";

import { bodyTextFromSource, toMessageMeta } from "./mapper";

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

export interface ImapConnectOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  secure?: boolean;
  bodyLimitBytes?: number;
  connectionTimeoutMs?: number;
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

class ImapMailProvider implements MailProvider {
  constructor(
    private readonly client: ImapFlow,
    private readonly bodyLimitBytes: number
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
        if (!Number.isFinite(box.uidNext)) throw new HardError("IMAP INBOX gave no valid UIDNEXT");
        return { uidValidity, uidNext: box.uidNext };
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

  async close(): Promise<void> {
    try {
      await this.client.logout();
    } catch {
      this.client.close();
    }
  }
}

export async function openImapProvider(opts: ImapConnectOptions): Promise<MailProvider> {
  const client = await connectImapClient(opts);
  return new ImapMailProvider(client, opts.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES);
}
