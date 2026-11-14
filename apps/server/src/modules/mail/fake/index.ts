import { HardError } from "../../../platform/errors";
import { contentFromHeaderBlock, contentFromSource } from "../imap/capture";
import {
  INBOX,
  MailFolderMissingError,
  MailNotFoundError,
  type FlagsOfMessage,
  type FolderMessageMeta,
  type FolderStatus,
  type MailCapabilities,
  type MailProvider,
  type MailServerInfo,
  type MessageMeta,
  type MoveResult,
  TRANSFER_MAX_BYTES,
  transferFlags,
} from "../port";
import { renderSeedMessage, type SeedMessage } from "../seed";
import { resolveUidNext } from "../uid-next";

import { parseRawHeaders } from "./raw";

export interface FakeMailProvider extends MailProvider {
  /** Returns the new uid. Creates the folder. */
  deliver(folder: string, msg: SeedMessage, opts?: { internalDate?: Date; size?: number }): number;
  /** Returns the new uid in `toFolder`. */
  userMove(fromFolder: string, uid: number, toFolder: string): number;
  remove(folder: string, uid: number): void;
  /**
   * `folder` (default INBOX) gets a new UIDVALIDITY and its uids are renumbered in the old order: from 1,
   * or with `globalUids` from the shared counter, so a UID stays unique in the mailbox.
   */
  resetUidValidity(next: number, folder?: string): void;
  /** The next call(s) of `method` throw `error`. For `deleteMessage` this also stops the delete step of a copy-path `moveMessage`. */
  failOn(method: keyof MailProvider, error: Error, times?: number): void;
  /** Method names in call order. */
  readonly calls: string[];
  /** Every call with its folder argument (or "" for calls without one), in call order. */
  readonly folderCalls: { method: string; folder: string }[];
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
  /** One UID counter for all folders, as Interia (F3). Default false (one counter per folder, as GreenMail, F6). */
  globalUids?: boolean;
  /** The STATUS UIDNEXT that the fake reports before the D4 rule; Interia gives 1 (F2). Default: the real next UID. */
  uidNextValue?: number;
  /** `appendMessage` and `transferByAppend` return the APPENDUID (default true); false mimics a server that drops it. */
  appendUid?: boolean;
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
  const globalUids = opts.globalUids ?? false;
  const appendUid = opts.appendUid ?? true;
  let globalNext = 1;
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
  const folderCalls: { method: string; folder: string }[] = [];

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

  function enter(method: keyof MailProvider, folder = ""): void {
    calls.push(method);
    folderCalls.push({ method, folder });
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
    const next = globalUids ? globalNext : target.uidNext;
    const uid = keepUid !== undefined && !target.messages.some((m) => m.uid === keepUid) ? keepUid : next;
    target.uidNext = Math.max(target.uidNext, uid + 1);
    globalNext = Math.max(globalNext, uid + 1);
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

  function existingFolder(path: string): Folder {
    const folder = folders.get(path);
    if (!folder) throw new MailFolderMissingError();
    return folder;
  }

  const provider: FakeMailProvider = {
    calls,
    folderCalls,
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

    resetUidValidity(next, folder = INBOX) {
      const target = folderOf(folder);
      target.uidValidity = next;
      target.messages.forEach((m, index) => {
        m.uid = globalUids ? globalNext + index : index + 1;
      });
      if (globalUids) globalNext += target.messages.length;
      target.uidNext = globalUids ? globalNext : target.messages.length + 1;
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

    async listFolders() {
      enter("listFolders");
      return [...folders.keys()].map((path) => ({ path, delimiter: pathDelimiter }));
    },

    async folderStatus(folder): Promise<FolderStatus> {
      enter("folderStatus", folder);
      const target = existingFolder(folder);
      const highestUid = target.messages.reduce((top, m) => Math.max(top, m.uid), 0);
      const realNext = globalUids ? globalNext : target.uidNext;
      return {
        uidValidity: target.uidValidity,
        uidNext: resolveUidNext({
          statusUidNext: opts.uidNextValue ?? realNext,
          selectUidNext: undefined,
          highestUid,
        }),
        highestUid,
      };
    },

    async fetchAbove(folder, lastUid) {
      enter("fetchAbove", folder);
      const target = existingFolder(folder);
      const above = target.messages.filter((m) => m.uid > lastUid);
      if (above.length === 0 && starQuirk && target.messages.length > 0) {
        const highest = target.messages.reduce((a, b) => (b.uid > a.uid ? b : a));
        return [toMeta(highest)];
      }
      return above.sort((a, b) => a.uid - b.uid).map(toMeta);
    },

    async fetchContent(folder, uid) {
      enter("fetchContent", folder);
      existingFolder(folder);
      const stored = find(folder, uid);
      if (!stored) return { text: null, capture: null };
      const raw = stored.raw ?? Buffer.from(renderSeedMessage(stored.msg));
      if (stored.size > bodyLimitBytes) {
        const end = raw.indexOf("\r\n\r\n");
        return (await contentFromHeaderBlock(end < 0 ? raw : raw.subarray(0, end))) ?? { text: null, capture: null };
      }
      const capture = (await contentFromSource(raw))?.capture ?? null;
      if (stored.msg.text !== undefined) return { text: stored.msg.text, capture };
      if (stored.msg.html !== undefined) return { text: stripTags(stored.msg.html), capture };
      return { text: null, capture };
    },

    async fetchFlagsIn(folder, uids) {
      enter("fetchFlagsIn", folder);
      const wanted = new Set(uids);
      return (folders.get(folder)?.messages ?? [])
        .filter((m) => wanted.has(m.uid))
        .sort((a, b) => a.uid - b.uid)
        .map(
          (m): FlagsOfMessage => ({
            uid: m.uid,
            flags: [...m.flags].sort(),
            messageId: m.msg.messageId || null,
            internalDate: new Date(m.internalDate),
          })
        );
    },

    async ensureFolder(name) {
      enter("ensureFolder", name);
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
      enter("fetchMetaIn", folder);
      const stored = find(folder, uid);
      return stored ? toFolderMeta(stored) : null;
    },

    async searchSinceIn(folder, since) {
      enter("searchSinceIn", folder);
      const day = utcDay(since);
      return (folders.get(folder)?.messages ?? [])
        .filter((m) => utcDay(m.internalDate) >= day)
        .map((m) => m.uid)
        .sort((a, b) => a - b);
    },

    async fetchByUidsIn(folder, uids) {
      enter("fetchByUidsIn", folder);
      const wanted = new Set(uids);
      return (folders.get(folder)?.messages ?? [])
        .filter((m) => wanted.has(m.uid))
        .sort((a, b) => a.uid - b.uid)
        .map(toFolderMeta);
    },

    async moveMessage(fromFolder, uid, toFolder): Promise<MoveResult> {
      enter("moveMessage", fromFolder);
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

    async transferByAppend(fromFolder, uid, toFolder): Promise<MoveResult> {
      enter("transferByAppend", fromFolder);
      const stored = find(fromFolder, uid);
      if (!stored) throw new MailNotFoundError(`No message ${uid} in the source folder`);
      if (!capabilities.uidplus) throw new HardError("no UIDPLUS");
      if (stored.size > TRANSFER_MAX_BYTES) throw new HardError("message too large to transfer");
      if (!folders.has(toFolder)) throw new HardError("NO [TRYCREATE]");
      const newUid = store(toFolder, stored.msg, stored.internalDate, stored.size, transferFlags(stored.flags));
      if (stored.raw) (find(toFolder, newUid) as StoredMessage).raw = Buffer.from(stored.raw);
      if (!appendUid) throw new HardError("append gave no uid");
      // `failOn("deleteMessage")` stops the delete step: the mail sits in both folders.
      failIfSet("deleteMessage");
      provider.remove(fromFolder, stored.uid);
      return { newUid };
    },

    async deleteMessage(folder, uid) {
      enter("deleteMessage", folder);
      if (!capabilities.uidplus) throw new HardError("no UIDPLUS");
      if (!find(folder, uid)) return false;
      provider.remove(folder, uid);
      return true;
    },

    async setFlags(folder, uid, change) {
      enter("setFlags", folder);
      const stored = find(folder, uid);
      if (!stored) throw new MailNotFoundError(`No message ${uid} in the folder`);
      for (const flag of change.add ?? []) stored.flags.add(flag);
      for (const flag of change.remove ?? []) stored.flags.delete(flag);
    },

    async appendMessage(folder, raw, flags, internalDate) {
      enter("appendMessage", folder);
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
      return { uid: capabilities.uidplus && appendUid ? uid : null };
    },

    async close() {
      enter("close");
      provider.closed = true;
    },
  };
  return provider;
}
