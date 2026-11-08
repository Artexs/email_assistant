import { HardError } from "../../../platform/errors";
import {
  INBOX,
  MailNotFoundError,
  type FolderMessageMeta,
  type InboxStatus,
  type MailCapabilities,
  type MailProvider,
  type MailServerInfo,
  type MessageMeta,
  type MoveResult,
} from "../port";
import { renderSeedMessage, type SeedMessage } from "../seed";

import { parseRawHeaders } from "./raw";

export interface FakeMailProvider extends MailProvider {
  /** Returns the new uid. Creates the folder. */
  deliver(folder: string, msg: SeedMessage, opts?: { internalDate?: Date; size?: number }): number;
  /** Returns the new uid in `toFolder`. */
  userMove(fromFolder: string, uid: number, toFolder: string): number;
  remove(folder: string, uid: number): void;
  /** INBOX: new UIDVALIDITY, uids renumbered from 1 in the old order. */
  resetUidValidity(next: number): void;
  /** The next call(s) of `method` throw `error`. For `deleteMessage` this also stops the delete step of a copy-path `moveMessage`. */
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
  /** A message that `moveMessage` copies keeps its UID in the target when that UID is free there (default false). */
  keepUidOnCopy?: boolean;
  /** Same for the `userMove` test helper, a move in a webmail (default false). Interia: copy false, user move true. */
  keepUidOnUserMove?: boolean;
  /** The delimiter of folder paths: `ensureFolder` replaces `/` in a name with it (default `/`). */
  pathDelimiter?: string;
  /** `moveMessage` returns `newUid`; false mimics a server without COPYUID (default true). */
  copyUidMap?: boolean;
  /** Special-use flag per folder path, reported by `serverInfo()` (default none), e.g. `{ "Junk": "\\Junk" }`. */
  folderSpecialUse?: Record<string, string>;
}

interface StoredMessage {
  uid: number;
  size: number;
  internalDate: Date;
  msg: SeedMessage;
  flags: Set<string>;
  /** Set by `appendMessage`: the bytes as appended. */
  raw?: Buffer;
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

/** `Name <a@b>` or `a@b` → `a@b`. */
function bareAddress(value: string): string {
  return /<([^<>]*)>/.exec(value)?.[1] ?? value.trim();
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

function toFolderMeta(stored: StoredMessage): FolderMessageMeta {
  return { ...toMeta(stored), flags: [...stored.flags].sort() };
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
  const keepUidOnCopy = opts.keepUidOnCopy ?? false;
  const keepUidOnUserMove = opts.keepUidOnUserMove ?? false;
  const pathDelimiter = opts.pathDelimiter ?? "/";
  const copyUidMap = opts.copyUidMap ?? true;
  const folderSpecialUse = opts.folderSpecialUse ?? {};
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

  function failIfSet(method: keyof MailProvider): void {
    const failure = failures.get(method);
    if (!failure) return;
    failure.times -= 1;
    if (failure.times <= 0) failures.delete(method);
    throw failure.error;
  }

  function enter(method: keyof MailProvider): void {
    calls.push(method);
    failIfSet(method);
  }

  function store(
    folder: string,
    msg: SeedMessage,
    internalDate: Date,
    size: number,
    flags: Iterable<string> = [],
    keepUid?: number
  ): number {
    const target = folderOf(folder);
    const uid = keepUid !== undefined && !target.messages.some((m) => m.uid === keepUid) ? keepUid : target.uidNext;
    target.uidNext = Math.max(target.uidNext, uid + 1);
    target.messages.push({ uid, size, internalDate, msg, flags: new Set(flags) });
    return uid;
  }

  /** Copies the message to `toFolder`, then removes the source. */
  function relocate(stored: StoredMessage, fromFolder: string, toFolder: string, keepUid: boolean): number {
    const newUid = store(
      toFolder,
      stored.msg,
      stored.internalDate,
      stored.size,
      stored.flags,
      keepUid ? stored.uid : undefined
    );
    provider.remove(fromFolder, stored.uid);
    return newUid;
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
      return relocate(stored, fromFolder, toFolder, keepUidOnUserMove);
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
        folders: [...folders.keys()].map((path) => ({ path, specialUse: folderSpecialUse[path] ?? null })),
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

    async ensureFolder(name) {
      enter("ensureFolder");
      const parts = name.split("/");
      // A parent that differs only in case is the user's folder: build the child from its real spelling.
      const real: string[] = [];
      for (let depth = 1; depth <= parts.length; depth++) {
        const exact = [...real, parts[depth - 1] as string].join(pathDelimiter);
        const lower = exact.toLowerCase();
        const keys = [...folders.keys()];
        // The exact spelling first, then the case-insensitive walk.
        const match =
          keys.find((key) => key === exact || key.startsWith(`${exact}${pathDelimiter}`)) ??
          keys.find((key) => key.toLowerCase() === lower || key.toLowerCase().startsWith(`${lower}${pathDelimiter}`));
        const level = match === undefined ? undefined : match.split(pathDelimiter).slice(0, depth);
        real.splice(0, real.length, ...(level ?? [...real, parts[depth - 1] as string]));
      }
      const path = real.join(pathDelimiter);
      if (folders.has(path)) return path;
      // A folder that differs only in case is the user's folder: use it, do not create a second one.
      const lower = path.toLowerCase();
      for (const existing of folders.keys()) {
        if (existing.toLowerCase() === lower) return existing;
      }
      folderOf(path);
      return path;
    },

    async fetchMetaIn(folder, uid) {
      enter("fetchMetaIn");
      const stored = find(folder, uid);
      return stored ? toFolderMeta(stored) : null;
    },

    async searchSinceIn(folder, since) {
      enter("searchSinceIn");
      const day = utcDay(since);
      return (folders.get(folder)?.messages ?? [])
        .filter((m) => utcDay(m.internalDate) >= day)
        .map((m) => m.uid)
        .sort((a, b) => a - b);
    },

    async fetchByUidsIn(folder, uids) {
      enter("fetchByUidsIn");
      const wanted = new Set(uids);
      return (folders.get(folder)?.messages ?? [])
        .filter((m) => wanted.has(m.uid))
        .sort((a, b) => a.uid - b.uid)
        .map(toFolderMeta);
    },

    async moveMessage(fromFolder, uid, toFolder): Promise<MoveResult> {
      enter("moveMessage");
      const stored = find(fromFolder, uid);
      if (!stored) throw new MailNotFoundError(`No message ${uid} in the source folder`);
      // Same order as a server: fetch, then the UIDPLUS check for the copy+delete path, then the write.
      if (!capabilities.move && !capabilities.uidplus) throw new HardError("no UIDPLUS");
      if (!folders.has(toFolder)) throw new HardError("NO [TRYCREATE]");
      // Both paths end in the same state; without MOVE a real server copies, then deletes.
      let newUid: number;
      if (capabilities.move) {
        newUid = relocate(stored, fromFolder, toFolder, keepUidOnCopy);
      } else {
        newUid = store(
          toFolder,
          stored.msg,
          stored.internalDate,
          stored.size,
          stored.flags,
          keepUidOnCopy ? stored.uid : undefined
        );
        // `failOn("deleteMessage")` stops the delete step of the copy path: the mail sits in both folders.
        failIfSet("deleteMessage");
        provider.remove(fromFolder, stored.uid);
      }
      return { newUid: copyUidMap && capabilities.uidplus ? newUid : null };
    },

    async deleteMessage(folder, uid) {
      enter("deleteMessage");
      if (!capabilities.uidplus) throw new HardError("no UIDPLUS");
      if (!find(folder, uid)) return false;
      provider.remove(folder, uid);
      return true;
    },

    async setFlags(folder, uid, change) {
      enter("setFlags");
      const stored = find(folder, uid);
      if (!stored) throw new MailNotFoundError(`No message ${uid} in the folder`);
      for (const flag of change.add ?? []) stored.flags.add(flag);
      for (const flag of change.remove ?? []) stored.flags.delete(flag);
    },

    async appendMessage(folder, raw, flags, internalDate) {
      enter("appendMessage");
      // Like a server: no folder, no APPEND (imapflow reports TRYCREATE).
      if (!folders.has(folder)) throw new HardError("NO [TRYCREATE]");
      const headers = parseRawHeaders(raw);
      const date = new Date(headers.get("date") ?? "");
      const actionId = headers.get("x-ea-action-id");
      const msg: SeedMessage = {
        messageId: headers.get("message-id") ?? "",
        from: bareAddress(headers.get("from") ?? ""),
        to: (headers.get("to") ?? "")
          .split(",")
          .map(bareAddress)
          .filter((part) => part !== ""),
        subject: headers.get("subject") ?? "",
        date: Number.isNaN(date.getTime()) ? internalDate : date,
        ...(headers.has("in-reply-to") ? { inReplyTo: headers.get("in-reply-to") as string } : {}),
        references: (headers.get("references") ?? "").split(/\s+/).filter((id) => id !== ""),
        ...(actionId === undefined ? {} : { headers: { "X-EA-Action-Id": actionId } }),
      };
      const uid = store(folder, msg, internalDate, raw.byteLength, flags);
      (find(folder, uid) as StoredMessage).raw = Buffer.from(raw);
      return { uid: capabilities.uidplus ? uid : null };
    },

    async close() {
      enter("close");
      provider.closed = true;
    },
  };
  return provider;
}
