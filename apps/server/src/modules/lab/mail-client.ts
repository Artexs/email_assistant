import { ImapFlow } from "imapflow";
import { createTransport } from "nodemailer";

// The lab's own door to GreenMail: SMTP in, IMAP read and APPEND. It is plain TCP to the sim stack, so it refuses any
// envelope address outside the list the caller gives (the scenario addresses of `labAddresses`). A failure carries a
// code and never the text of a mail, an address or a server answer.
export interface LabMailClient {
  smtpSend(input: { envelopeFrom: string; to: string; raw: string }): Promise<void>;
  /** APPENDs to the folder `Sent` of the mailbox with the flag \Seen; creates the folder when it is missing. */
  appendSent(mailbox: string, raw: string): Promise<void>;
  /** True when a mail with this Message-ID is in any folder of the mailbox (the sim server may have moved it out of the INBOX). */
  hasMessageId(mailbox: string, messageId: string): Promise<boolean>;
  /** The mail of `folder` with a UID above `afterUid`, in UID order. */
  fetchSince(mailbox: string, folder: string, afterUid: number): Promise<{ uid: number; raw: string }[]>;
  /** The highest UID of `folder`; 0 when it is empty. */
  newestUid(mailbox: string, folder: string): Promise<number>;
}

export interface LabMailClientOptions {
  host: string;
  imapPort: number;
  smtpPort: number;
  password: string;
  allowedAddresses: ReadonlySet<string>;
}

export type LabMailErrorCode = "address_refused" | "smtp_failed" | "imap_failed";

export class LabMailError extends Error {
  constructor(readonly code: LabMailErrorCode) {
    super(`lab mail: ${code}`);
    this.name = "LabMailError";
  }
}

const SENT = "Sent";
const TIMEOUT_MS = 15_000;

export function createLabMailClient(options: LabMailClientOptions): LabMailClient {
  const allowed = new Set([...options.allowedAddresses].map((address) => address.toLowerCase()));

  async function withImap<T>(mailbox: string, run: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: options.host,
      port: options.imapPort,
      secure: false,
      doSTARTTLS: false,
      auth: { user: mailbox, pass: options.password },
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    // Without a listener an "error" event ends the process.
    client.on("error", () => undefined);
    try {
      await client.connect();
      return await run(client);
    } catch {
      throw new LabMailError("imap_failed");
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

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
        connectionTimeout: TIMEOUT_MS,
        greetingTimeout: TIMEOUT_MS,
        socketTimeout: TIMEOUT_MS,
      });
      try {
        await transport.sendMail({ envelope: { from: envelopeFrom, to: [to] }, raw });
      } catch {
        throw new LabMailError("smtp_failed");
      } finally {
        transport.close();
      }
    },

    appendSent(mailbox, raw) {
      return withImap(mailbox, async (client) => {
        const exists = (await client.list()).some((entry) => entry.path === SENT);
        if (!exists) await client.mailboxCreate(SENT);
        await client.append(SENT, raw, ["\\Seen"]);
      });
    },

    hasMessageId(mailbox, messageId) {
      return withImap(mailbox, async (client) => {
        for (const entry of await client.list()) {
          if (entry.flags.has("\\Noselect")) continue;
          const lock = await client.getMailboxLock(entry.path, { readOnly: true });
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
      return withImap(mailbox, async (client) => {
        const lock = await client.getMailboxLock(folder, { readOnly: true });
        try {
          const found: { uid: number; raw: string }[] = [];
          // `n:*` always returns the last mail, even when its UID is below `n`: the filter keeps the UID order exact.
          for await (const message of client.fetch(`${afterUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
            if (message.uid > afterUid && message.source !== undefined) {
              found.push({ uid: message.uid, raw: message.source.toString("utf8") });
            }
          }
          return found.sort((left, right) => left.uid - right.uid);
        } finally {
          lock.release();
        }
      });
    },

    newestUid(mailbox, folder) {
      return withImap(mailbox, async (client) => {
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
