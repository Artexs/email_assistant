import { INBOX } from "../mail";

import { LabMailError, type LabMailClient, type LabMailErrorCode } from "./mail-client";

// An in-memory `LabMailClient` for unit tests of the lab bots and the injector. It keeps the rules of the port in
// `mail-client.ts`: UIDs rise by one per folder and are never reused, a missing folder reads as an empty list (or 0),
// and an SMTP envelope address outside `allowedAddresses` ends with `address_refused`. With no `allowedAddresses` the
// fake refuses every address, so a test must name the ones it allows. It has no IMAP server: a move between folders or a
// search by a header other than the Message-ID is not here (an integration case against the real server covers those).

type Method = keyof LabMailClient;

export interface SentMail {
  envelopeFrom: string;
  to: string;
  raw: string;
}

export interface AppendedMail {
  mailbox: string;
  raw: string;
}

export interface FakeLabMailClient extends LabMailClient {
  /** Every `smtpSend` input that went through, in order. A refused or failed call is not here. */
  readonly sent: readonly SentMail[];
  /** Every `appendSent` call that went through, in order. */
  readonly appended: readonly AppendedMail[];
  /** How many times each method was called, a refused or failed call included. */
  readonly calls: Readonly<Record<Method, number>>;
  /** Puts a mail in a folder with the next UID, as the sim server does: no address check. Returns the UID. */
  deliver(mailbox: string, folder: string, raw: string): number;
  /** The next call of `method` rejects with `error`. Calls to `failNext` queue up, one failure per call. */
  failNext(method: Method, error: unknown): void;
}

const SENT_FOLDER = "Sent";

const messageIdOf = (raw: string): string | undefined => /^message-id:[ \t]*(\S+)/im.exec(raw)?.[1];

export function createFakeLabMailClient(options: { allowedAddresses?: ReadonlySet<string> } = {}): FakeLabMailClient {
  const allowed = new Set([...(options.allowedAddresses ?? [])].map((address) => address.toLowerCase()));
  const folders = new Map<string, { uid: number; raw: string }[]>();
  const lastUid = new Map<string, number>();
  const sent: SentMail[] = [];
  const appended: AppendedMail[] = [];
  const calls: Record<Method, number> = { smtpSend: 0, appendSent: 0, hasMessageId: 0, fetchSince: 0, newestUid: 0 };
  const failures = new Map<Method, unknown[]>();

  const folderKey = (mailbox: string, folder: string): string => `${mailbox.toLowerCase()}\u0000${folder}`;
  const put = (mailbox: string, folder: string, raw: string): number => {
    const key = folderKey(mailbox, folder);
    const uid = (lastUid.get(key) ?? 0) + 1;
    lastUid.set(key, uid);
    folders.set(key, [...(folders.get(key) ?? []), { uid, raw }]);
    return uid;
  };
  // A call that was told to fail rejects before it does anything, as a lost connection would.
  const enter = (method: Method): void => {
    calls[method] += 1;
    const queue = failures.get(method) ?? [];
    if (queue.length > 0) throw queue.shift();
  };
  const refuse = (code: LabMailErrorCode): never => {
    throw new LabMailError(code);
  };

  return {
    sent,
    appended,
    calls,

    async smtpSend({ envelopeFrom, to, raw }) {
      enter("smtpSend");
      if (!allowed.has(envelopeFrom.toLowerCase()) || !allowed.has(to.toLowerCase())) refuse("address_refused");
      put(to, INBOX, raw);
      sent.push({ envelopeFrom, to, raw });
    },

    async appendSent(mailbox, raw) {
      enter("appendSent");
      put(mailbox, SENT_FOLDER, raw);
      appended.push({ mailbox, raw });
    },

    async hasMessageId(mailbox, messageId) {
      enter("hasMessageId");
      const prefix = `${mailbox.toLowerCase()}\u0000`;
      for (const [key, rows] of folders) {
        if (key.startsWith(prefix) && rows.some((row) => messageIdOf(row.raw) === messageId)) return true;
      }
      return false;
    },

    async fetchSince(mailbox, folder, afterUid) {
      enter("fetchSince");
      return (folders.get(folderKey(mailbox, folder)) ?? []).filter((row) => row.uid > afterUid);
    },

    async newestUid(mailbox, folder) {
      enter("newestUid");
      return lastUid.get(folderKey(mailbox, folder)) ?? 0;
    },

    deliver: put,

    failNext(method, error) {
      failures.set(method, [...(failures.get(method) ?? []), error]);
    },
  };
}
