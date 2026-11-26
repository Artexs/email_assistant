import { ImapFlow } from "imapflow";
import { createTransport } from "nodemailer";

// The lab's own client for the sim GreenMail: SMTP delivery into a mailbox, IMAP APPEND, and reads for the exactly-once
// checks. GreenMail runs with auth off, so any password logs in. It is not a product mail path: no product host guard
// and no credentials. Two guards stand before any traffic: the host must be loopback (`host_refused`) and every SMTP
// envelope address must be in the list the caller gives (`address_refused`; the scenario addresses of `labAddresses`).
// The injector, the delegate bots and the org reset share it.
// Errors carry a short code, never the text of the server or of a message.

export type LabMailErrorCode =
  | "smtp_failed"
  | "imap_connect"
  | "host_refused"
  | "imap_search"
  | "imap_append"
  | "imap_fetch"
  | "address_refused";

export class LabMailError extends Error {
  readonly code: LabMailErrorCode;
  // A short transport code such as `ECONNREFUSED`; `unknown` when the library gave none that looks like a code.
  readonly detail: string;

  constructor(code: LabMailErrorCode, cause?: unknown) {
    super(code);
    this.name = "LabMailError";
    this.code = code;
    const raw = (cause as { code?: unknown } | null)?.code;
    this.detail = typeof raw === "string" && /^[A-Za-z][A-Za-z0-9_]{1,40}$/.test(raw) ? raw : "unknown";
  }
}

export interface LabMailClient {
  /** SMTP delivery. The envelope decides who gets the mail; the headers of `raw` are not read for it. */
  smtpSend(input: { envelopeFrom: string; to: string; raw: string }): Promise<void>;
  /** APPEND into `Sent` of the mailbox with `\Seen`. Creates the folder when it does not exist. */
  appendSent(mailbox: string, raw: string): Promise<void>;
  /** True when a mail with this Message-ID is in any folder of the mailbox (a server may have moved it from the INBOX). */
  hasMessageId(mailbox: string, messageId: string): Promise<boolean>;
  /** The mails of one folder with a UID above `afterUid`, in UID order. A missing folder gives an empty list. */
  fetchSince(mailbox: string, folder: string, afterUid: number): Promise<{ uid: number; raw: string }[]>;
  /** The highest UID of one folder; 0 when the folder is missing or empty. */
  newestUid(mailbox: string, folder: string): Promise<number>;
}

/** What the org reset needs on top of `LabMailClient`. Only a mailbox in `allowedAddresses` (else `address_refused`). */
export interface LabMailAdmin {
  /** The number of mails in every folder of the mailbox. */
  countMessages(mailbox: string): Promise<number>;
  /** Deletes every mail in every folder of the mailbox and returns the count. The folders stay. */
  emptyMailbox(mailbox: string): Promise<number>;
}

/** The INBOX writes and reads of the demo setup. Only a mailbox in `allowedAddresses` (else `address_refused`). */
export interface LabMailInbox {
  /** APPEND into the INBOX of the mailbox with the given internal date (the date the server stored the mail). No flags: the mail is unread. */
  appendInbox(mailbox: string, raw: string, internalDate: Date): Promise<void>;
  /** The number of mails in the INBOX of the mailbox; 0 when it does not exist yet. */
  countInbox(mailbox: string): Promise<number>;
}

export interface LabMailClientOptions {
  host: string;
  imapPort: number;
  smtpPort: number;
  /** Any password logs in with GreenMail auth off (`LAB_MAIL_PASSWORD`). */
  password: string;
  /** The envelope addresses `smtpSend` may use, as the `labAddresses` of the corpus (compared in lower case). */
  allowedAddresses: ReadonlySet<string>;
}

const SENT_FOLDER = "Sent";
const IMAP_TIMEOUT_MS = 15_000;

async function withImap<T>(
  options: LabMailClientOptions,
  mailbox: string,
  code: LabMailErrorCode,
  fn: (client: ImapFlow) => Promise<T>
): Promise<T> {
  const client = new ImapFlow({
    host: options.host,
    port: options.imapPort,
    secure: false,
    doSTARTTLS: false,
    auth: { user: mailbox, pass: options.password },
    // The default logger prints the protocol, mail text included.
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: IMAP_TIMEOUT_MS,
    greetingTimeout: IMAP_TIMEOUT_MS,
    socketTimeout: IMAP_TIMEOUT_MS,
  });
  // Without a listener, an "error" event would end the process.
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch (error) {
    client.close();
    throw new LabMailError("imap_connect", error);
  }
  try {
    return await fn(client);
  } catch (error) {
    throw error instanceof LabMailError ? error : new LabMailError(code, error);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

// Every selectable folder of the mailbox, with the lock of the folder held while `fn` runs.
async function eachFolder(client: ImapFlow, readOnly: boolean, fn: () => Promise<number>): Promise<number> {
  let total = 0;
  for (const folder of await client.list()) {
    if (folder.flags.has("\\Noselect") || folder.flags.has("\\NonExistent")) continue;
    const lock = await client.getMailboxLock(folder.path, { readOnly });
    try {
      total += await fn();
    } finally {
      lock.release();
    }
  }
  return total;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

// The client talks to the sim GreenMail only. In the sim stack GreenMail shares the network namespace of the lab, so its
// host is loopback (`LAB_MAIL_HOST`); any other host is refused before a connection opens, so no lab mail can leave the stack.
export function createLabMailClient(options: LabMailClientOptions): LabMailClient & LabMailAdmin & LabMailInbox {
  if (!LOOPBACK_HOSTS.has(options.host.toLowerCase())) throw new LabMailError("host_refused");
  const allowed = new Set([...options.allowedAddresses].map((address) => address.toLowerCase()));
  const requireAllowed = (mailbox: string): void => {
    if (!allowed.has(mailbox.toLowerCase())) throw new LabMailError("address_refused");
  };
  return {
    async smtpSend({ envelopeFrom, to, raw }) {
      if (!allowed.has(envelopeFrom.toLowerCase()) || !allowed.has(to.toLowerCase())) {
        throw new LabMailError("address_refused");
      }
      const transport = createTransport({
        host: options.host,
        port: options.smtpPort,
        secure: false,
        ignoreTLS: true,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
      });
      try {
        await transport.sendMail({ envelope: { from: envelopeFrom, to: [to] }, raw });
      } catch (error) {
        throw new LabMailError("smtp_failed", error);
      } finally {
        transport.close();
      }
    },

    appendSent(mailbox, raw) {
      return withImap(options, mailbox, "imap_append", async (client) => {
        const folders = await client.list();
        if (!folders.some((entry) => entry.path === SENT_FOLDER)) await client.mailboxCreate(SENT_FOLDER);
        await client.append(SENT_FOLDER, raw, ["\\Seen"]);
      });
    },

    hasMessageId(mailbox, messageId) {
      return withImap(options, mailbox, "imap_search", async (client) => {
        const folders = await client.list();
        for (const folder of folders) {
          if (folder.flags.has("\\Noselect") || folder.flags.has("\\NonExistent")) continue;
          const lock = await client.getMailboxLock(folder.path, { readOnly: true });
          try {
            const found = await client.search({ header: { "message-id": messageId } }, { uid: true });
            if (found !== false && found.length > 0) return true;
          } finally {
            lock.release();
          }
        }
        return false;
      });
    },

    fetchSince(mailbox, folder, afterUid) {
      return withImap(options, mailbox, "imap_fetch", async (client) => {
        const folders = await client.list();
        if (!folders.some((entry) => entry.path === folder)) return [];
        const lock = await client.getMailboxLock(folder, { readOnly: true });
        try {
          const rows: { uid: number; raw: string }[] = [];
          if (client.mailbox !== false && client.mailbox.exists === 0) return rows;
          // `n:*` always returns the last mail, even when its UID is below `n`: the filter below drops it.
          for await (const message of client.fetch(`${afterUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
            if (message.uid > afterUid && message.source !== undefined) {
              rows.push({ uid: message.uid, raw: message.source.toString("utf8") });
            }
          }
          return rows.sort((a, b) => a.uid - b.uid);
        } finally {
          lock.release();
        }
      });
    },

    async countMessages(mailbox) {
      requireAllowed(mailbox);
      return withImap(options, mailbox, "imap_fetch", (client) =>
        eachFolder(client, true, async () => (client.mailbox === false ? 0 : client.mailbox.exists))
      );
    },

    async appendInbox(mailbox, raw, internalDate) {
      requireAllowed(mailbox);
      await withImap(options, mailbox, "imap_append", async (client) => {
        await client.append("INBOX", raw, [], internalDate);
      });
    },

    async countInbox(mailbox) {
      requireAllowed(mailbox);
      return withImap(options, mailbox, "imap_fetch", async (client) => {
        const status = await client.status("INBOX", { messages: true });
        return status.messages ?? 0;
      });
    },

    async emptyMailbox(mailbox) {
      requireAllowed(mailbox);
      return withImap(options, mailbox, "imap_fetch", (client) =>
        eachFolder(client, false, async () => {
          const count = client.mailbox === false ? 0 : client.mailbox.exists;
          if (count > 0) await client.messageDelete("1:*");
          return count;
        })
      );
    },

    newestUid(mailbox, folder) {
      return withImap(options, mailbox, "imap_fetch", async (client) => {
        const folders = await client.list();
        if (!folders.some((entry) => entry.path === folder)) return 0;
        const lock = await client.getMailboxLock(folder, { readOnly: true });
        try {
          const found = await client.search({ all: true }, { uid: true });
          return found === false || found.length === 0 ? 0 : Math.max(...found);
        } finally {
          lock.release();
        }
      });
    },
  };
}
