import { ImapFlow } from "imapflow";
import { createTransport } from "nodemailer";

// The lab's own client for the sim GreenMail: SMTP delivery into a mailbox, IMAP APPEND, and reads for the exactly-once
// checks. GreenMail runs with auth off, so any password logs in. It is not a product mail path: no host guard, no
// credentials, loopback host and fixed ports from the lab config. Stages 08 (bots) and 14 (reset) reuse it.
// Errors carry a short code, never the text of the server or of a message.

export type LabMailErrorCode =
  | "smtp_failed"
  | "imap_connect"
  | "imap_list"
  | "imap_search"
  | "imap_append"
  | "imap_fetch";

export class LabMailError extends Error {
  readonly code: LabMailErrorCode;
  // A short transport code such as `ECONNREFUSED`; `unknown` when the library gave none that looks like a code.
  readonly detail: string;

  constructor(code: LabMailErrorCode, cause: unknown) {
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
}

export interface GreenMailOptions {
  host: string;
  imapPort: number;
  smtpPort: number;
}

const SENT_FOLDER = "Sent";
// Any password is accepted by GreenMail with auth off.
const PLACEHOLDER_PASSWORD = "lab";

async function withImap<T>(
  options: GreenMailOptions,
  mailbox: string,
  code: LabMailErrorCode,
  fn: (client: ImapFlow) => Promise<T>
): Promise<T> {
  const client = new ImapFlow({
    host: options.host,
    port: options.imapPort,
    secure: false,
    doSTARTTLS: false,
    auth: { user: mailbox, pass: PLACEHOLDER_PASSWORD },
    // The default logger prints the protocol, mail text included.
    logger: false,
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

export function createGreenMailClient(options: GreenMailOptions): LabMailClient {
  return {
    async smtpSend({ envelopeFrom, to, raw }) {
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
  };
}
