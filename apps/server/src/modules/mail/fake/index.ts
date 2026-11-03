import { HardError } from "../../../platform/errors";
import {
  INBOX,
  type InboxStatus,
  type MailCapabilities,
  type MailProvider,
  type MailServerInfo,
  type MessageMeta,
} from "../port";
import { renderSeedMessage, type SeedMessage } from "../seed";

export interface FakeMailProvider extends MailProvider {
  /** Returns the new uid. Creates the folder. */
  deliver(folder: string, msg: SeedMessage, opts?: { internalDate?: Date; size?: number }): number;
  /** Returns the new uid in `toFolder`. */
  userMove(fromFolder: string, uid: number, toFolder: string): number;
  remove(folder: string, uid: number): void;
  /** INBOX: new UIDVALIDITY, uids renumbered from 1 in the old order. */
  resetUidValidity(next: number): void;
  /** The next call(s) of `method` throw `error`. */
  failOn(method: keyof MailProvider, error: Error, times?: number): void;
  /** Method names in call order. */
  readonly calls: string[];
  closed: boolean;
}

export interface FakeMailProviderOptions {
  uidValidity?: number;
  capabilities?: Partial<MailCapabilities>;
  bodyLimitBytes?: number;
  /** Mimic the RFC 3501 `n:*` rule (default true). */
  starQuirk?: boolean;
}

interface StoredMessage {
  uid: number;
  size: number;
  internalDate: Date;
  msg: SeedMessage;
}

interface Folder {
  uidValidity: number;
  uidNext: number;
  messages: StoredMessage[];
}

function findHeader(msg: SeedMessage, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(msg.headers ?? {})) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

function toMeta(stored: StoredMessage): MessageMeta {
  const { msg } = stored;
  return {
    uid: stored.uid,
    size: stored.size,
    internalDate: new Date(stored.internalDate),
    date: msg.date,
    messageId: msg.messageId || null,
    inReplyTo: msg.inReplyTo ?? null,
    references: [...(msg.references ?? [])],
    from: msg.from,
    to: [...msg.to],
    cc: [...(msg.cc ?? [])],
    subject: msg.subject,
    actionId: findHeader(msg, "X-EA-Action-Id"),
  };
}

function utcDay(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createFakeMailProvider(opts: FakeMailProviderOptions = {}): FakeMailProvider {
  const bodyLimitBytes = opts.bodyLimitBytes ?? 5_000_000;
  const starQuirk = opts.starQuirk ?? true;
  const capabilities: MailCapabilities = {
    idle: true,
    move: true,
    uidplus: true,
    condstore: true,
    specialUse: true,
    keywords: true,
    ...opts.capabilities,
  };
  const folders = new Map<string, Folder>();
  const failures = new Map<string, { error: Error; times: number }>();
  const calls: string[] = [];

  function folderOf(path: string): Folder {
    let folder = folders.get(path);
    if (!folder) {
      folder = { uidValidity: 1, uidNext: 1, messages: [] };
      folders.set(path, folder);
    }
    return folder;
  }

  folderOf(INBOX).uidValidity = opts.uidValidity ?? 1;

  function enter(method: keyof MailProvider): void {
    calls.push(method);
    const failure = failures.get(method);
    if (!failure) return;
    failure.times -= 1;
    if (failure.times <= 0) failures.delete(method);
    throw failure.error;
  }

  function store(folder: string, msg: SeedMessage, internalDate: Date, size: number): number {
    const target = folderOf(folder);
    const uid = target.uidNext;
    target.uidNext += 1;
    target.messages.push({ uid, size, internalDate, msg });
    return uid;
  }

  function find(folder: string, uid: number): StoredMessage | undefined {
    return folders.get(folder)?.messages.find((m) => m.uid === uid);
  }

  const provider: FakeMailProvider = {
    calls,
    closed: false,

    deliver(folder, msg, deliverOpts = {}) {
      const size = deliverOpts.size ?? Buffer.byteLength(renderSeedMessage(msg));
      return store(folder, msg, deliverOpts.internalDate ?? new Date(), size);
    },

    userMove(fromFolder, uid, toFolder) {
      const stored = find(fromFolder, uid);
      if (!stored) throw new HardError(`No message ${uid} in ${fromFolder}`);
      provider.remove(fromFolder, uid);
      return store(toFolder, stored.msg, stored.internalDate, stored.size);
    },

    remove(folder, uid) {
      const target = folders.get(folder);
      if (!target) return;
      target.messages = target.messages.filter((m) => m.uid !== uid);
    },

    resetUidValidity(next) {
      const inbox = folderOf(INBOX);
      inbox.uidValidity = next;
      inbox.messages.forEach((m, index) => {
        m.uid = index + 1;
      });
      inbox.uidNext = inbox.messages.length + 1;
    },

    failOn(method, error, times = 1) {
      failures.set(method, { error, times });
    },

    async serverInfo(): Promise<MailServerInfo> {
      enter("serverInfo");
      return {
        capabilities: { ...capabilities },
        folders: [...folders.keys()].map((path) => ({ path, specialUse: null })),
      };
    },

    async inboxStatus(): Promise<InboxStatus> {
      enter("inboxStatus");
      const inbox = folderOf(INBOX);
      return { uidValidity: inbox.uidValidity, uidNext: inbox.uidNext };
    },

    async fetchAbove(lastUid) {
      enter("fetchAbove");
      const inbox = folderOf(INBOX);
      const above = inbox.messages.filter((m) => m.uid > lastUid);
      if (above.length === 0 && starQuirk && inbox.messages.length > 0) {
        const highest = inbox.messages.reduce((a, b) => (b.uid > a.uid ? b : a));
        return [toMeta(highest)];
      }
      return above.sort((a, b) => a.uid - b.uid).map(toMeta);
    },

    async searchInboxSince(since) {
      enter("searchInboxSince");
      const day = utcDay(since);
      return folderOf(INBOX)
        .messages.filter((m) => utcDay(m.internalDate) >= day)
        .map((m) => m.uid)
        .sort((a, b) => a - b);
    },

    async fetchByUids(uids) {
      enter("fetchByUids");
      const wanted = new Set(uids);
      return folderOf(INBOX)
        .messages.filter((m) => wanted.has(m.uid))
        .sort((a, b) => a.uid - b.uid)
        .map(toMeta);
    },

    async fetchBodyText(uid) {
      enter("fetchBodyText");
      const stored = find(INBOX, uid);
      if (!stored || stored.size > bodyLimitBytes) return null;
      if (stored.msg.text !== undefined) return stored.msg.text;
      if (stored.msg.html !== undefined) return stripTags(stored.msg.html);
      return null;
    },

    async findByMessageId(folder, messageId) {
      enter("findByMessageId");
      const found = folders.get(folder)?.messages.find((m) => m.msg.messageId === messageId);
      return found?.uid ?? null;
    },

    async close() {
      enter("close");
      provider.closed = true;
    },
  };
  return provider;
}
