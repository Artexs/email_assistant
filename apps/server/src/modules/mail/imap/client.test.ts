import { describe, expect, test } from "bun:test";
import type { ImapFlow } from "imapflow";

import { HardError, SoftError } from "../../../platform/errors";
import { MailAuthError } from "../port";

import { createImapMailProvider, imapFlowOptions, isLoopbackHost, matchFolder, toMailError } from "./client";

const creds = { user: "me@interia.pl", password: "pw-secret-1" };

describe("isLoopbackHost", () => {
  test("knows the loopback names", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("poczta.interia.pl")).toBe(false);
    expect(isLoopbackHost("127.0.0.1.example.test")).toBe(false);
  });
});

describe("imapFlowOptions", () => {
  test("a remote host gets TLS on, no tls key and no doSTARTTLS", () => {
    const options = imapFlowOptions({ host: "poczta.interia.pl", port: 993, ...creds });
    expect(options.secure).toBe(true);
    expect("tls" in options).toBe(false);
    expect("doSTARTTLS" in options).toBe(false);
    expect(options).toMatchObject({
      host: "poczta.interia.pl",
      port: 993,
      auth: { user: creds.user, pass: creds.password },
      logger: false,
      disableAutoIdle: true,
      connectionTimeout: 30_000,
    });
  });

  test("a loopback host gets plain IMAP with doSTARTTLS false", () => {
    const options = imapFlowOptions({ host: "127.0.0.1", port: 3143, ...creds });
    expect(options.secure).toBe(false);
    expect(options.doSTARTTLS).toBe(false);
    expect("tls" in options).toBe(false);
  });

  test("a loopback host with secure true keeps TLS on", () => {
    const options = imapFlowOptions({ host: "127.0.0.1", port: 3993, secure: true, ...creds });
    expect(options.secure).toBe(true);
    expect("doSTARTTLS" in options).toBe(false);
  });

  test("secure false with a remote host throws HardError", () => {
    expect(() => imapFlowOptions({ host: "poczta.interia.pl", port: 143, secure: false, ...creds })).toThrow(
      new HardError("plain IMAP is allowed only to a loopback host")
    );
  });

  test("connectionTimeoutMs is passed on", () => {
    const options = imapFlowOptions({ host: "poczta.interia.pl", port: 993, connectionTimeoutMs: 5_000, ...creds });
    expect(options.connectionTimeout).toBe(5_000);
  });
});

describe("toMailError", () => {
  test("an authentication failure gives MailAuthError without the password", () => {
    const original = Object.assign(new Error(`Authentication failed for ${creds.password}`), {
      authenticationFailed: true,
    });
    const error = toMailError(original, "login");
    expect(error).toBeInstanceOf(MailAuthError);
    expect(error.message).not.toContain(creds.password);
    expect(error.cause).toBe(original);
  });

  test("connection codes give SoftError", () => {
    for (const code of ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ENOTFOUND", "NoConnection", "ETIMEOUT"]) {
      const original = Object.assign(new Error("x"), { code });
      const error = toMailError(original, "fetch");
      expect(error).toBeInstanceOf(SoftError);
      expect(error.cause).toBe(original);
    }
  });

  test("other errors give HardError", () => {
    const original = Object.assign(new Error("self-signed certificate"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
    const error = toMailError(original, "connect");
    expect(error).toBeInstanceOf(HardError);
    expect(error).not.toBeInstanceOf(MailAuthError);
    expect(error.cause).toBe(original);
    expect(toMailError("text", "connect")).toBeInstanceOf(HardError);
  });

  test("typed errors pass through", () => {
    const soft = new SoftError("x");
    expect(toMailError(soft, "fetch")).toBe(soft);
  });
});

describe("matchFolder", () => {
  test("matches the path, the parts with another delimiter, and the parts after a namespace prefix", () => {
    expect(matchFolder([{ path: "AI/Spam", delimiter: "/" }], "AI/Spam", "")).toBe("AI/Spam");
    expect(matchFolder([{ path: "AI.Spam", delimiter: "." }], "AI/Spam", "")).toBe("AI.Spam");
    expect(matchFolder([{ path: "INBOX.AI.Spam", delimiter: "." }], "AI/Spam", "INBOX.")).toBe("INBOX.AI.Spam");
    expect(matchFolder([{ path: "INBOX", delimiter: "." }], "INBOX", "INBOX.")).toBe("INBOX");
  });

  test("uses a folder that differs only in case; the exact path wins", () => {
    expect(matchFolder([{ path: "ai/spam", delimiter: "/" }], "AI/Spam", "")).toBe("ai/spam");
    expect(matchFolder([{ path: "Ai.Spam", delimiter: "." }], "AI/Spam", "")).toBe("Ai.Spam");
    const both = [
      { path: "ai/spam", delimiter: "/" },
      { path: "AI/Spam", delimiter: "/" },
    ];
    expect(matchFolder(both, "AI/Spam", "")).toBe("AI/Spam");
  });

  test("gives null when no entry matches", () => {
    expect(matchFolder([{ path: "AI", delimiter: "/" }], "AI/Spam", "")).toBeNull();
    expect(matchFolder([{ path: "AI.Spam.Old", delimiter: "." }], "AI/Spam", "")).toBeNull();
    expect(matchFolder([], "AI", "")).toBeNull();
  });
});

interface StubOptions {
  capabilities?: string[];
  folders?: string[];
  copy?: unknown;
  move?: unknown;
  deleted?: boolean;
  flagsAdd?: boolean;
  flagsRemove?: boolean;
  /** The message stays in the folder after a delete that reports true. */
  survivesDelete?: boolean;
  /** The UID that fetchOne reports, instead of the asked one. */
  fetchedUid?: number;
  /** What `search` gives (default: no match). */
  search?: number[] | false;
}

function stubProvider(options: StubOptions, forceCopyMove = false) {
  const calls: string[] = [];
  let removed = false;
  const folders = [...(options.folders ?? ["INBOX"])];
  const client = {
    capabilities: new Map((options.capabilities ?? ["UIDPLUS"]).map((name) => [name, true])),
    namespace: { prefix: "", delimiter: "/" },
    list: async () => folders.map((path) => ({ path, delimiter: "/" })),
    mailboxCreate: async (parts: string | string[]) => {
      const path = Array.isArray(parts) ? parts.join("/") : parts;
      calls.push(`create:${path}`);
      folders.push(path);
      return { path, created: true };
    },
    getMailboxLock: async () => ({ release: () => undefined }),
    search: async () => options.search ?? [],
    fetchOne: async (range: string) =>
      removed ? false : { uid: options.fetchedUid ?? Number(range), flags: new Set<string>() },
    messageCopy: async () => {
      calls.push("copy");
      return "copy" in options ? options.copy : { uidMap: new Map([[5, 9]]) };
    },
    messageMove: async () => {
      calls.push("move");
      return "move" in options ? options.move : { uidMap: new Map([[5, 9]]) };
    },
    messageDelete: async () => {
      calls.push("delete");
      removed = !options.survivesDelete;
      return options.deleted ?? true;
    },
    messageFlagsAdd: async (_range: string, flags: string[]) => {
      calls.push(`add:${flags.join(",")}`);
      return options.flagsAdd ?? true;
    },
    messageFlagsRemove: async () => options.flagsRemove ?? true,
  };
  const provider = createImapMailProvider(client as unknown as ImapFlow, { bodyLimitBytes: 1000, forceCopyMove });
  return { provider, calls };
}

describe("IMAP adapter writes (stub client)", () => {
  test("ensureFolder creates the parent before the child", async () => {
    const { provider, calls } = stubProvider({});
    expect(await provider.ensureFolder("AI/Spam")).toBe("AI/Spam");
    expect(calls).toEqual(["create:AI", "create:AI/Spam"]);
  });

  test("ensureFolder creates only the missing level", async () => {
    const { provider, calls } = stubProvider({ folders: ["INBOX", "AI"] });
    await provider.ensureFolder("AI/Spam");
    expect(calls).toEqual(["create:AI/Spam"]);
  });

  test("ensureFolder builds the child from the real parent path when the case differs", async () => {
    const { provider, calls } = stubProvider({ folders: ["INBOX", "ai"] });
    expect(await provider.ensureFolder("AI/Spam")).toBe("ai/Spam");
    expect(calls).toEqual(["create:ai/Spam"]);
  });

  test("deleteMessage throws expunge refused when messageDelete gives false", async () => {
    const { provider } = stubProvider({ deleted: false });
    await expect(provider.deleteMessage("INBOX", 5)).rejects.toThrow(new HardError("expunge refused"));
  });

  test("deleteMessage without UIDPLUS throws before any write", async () => {
    const { provider, calls } = stubProvider({ capabilities: [] });
    await expect(provider.deleteMessage("INBOX", 5)).rejects.toThrow(new HardError("no UIDPLUS"));
    expect(calls).toEqual([]);
  });

  test("deleteMessage never sets \\Deleted by itself", async () => {
    const { provider, calls } = stubProvider({});
    expect(await provider.deleteMessage("INBOX", 5)).toBe(true);
    expect(calls).toEqual(["delete"]);
  });

  test("the COPY path stops at a refused COPY and never deletes", async () => {
    const { provider, calls } = stubProvider({ copy: false });
    await expect(provider.moveMessage("INBOX", 5, "AI")).rejects.toThrow(new HardError("copy refused"));
    expect(calls).toEqual(["copy"]);
  });

  test("the COPY path copies, then deletes, and gives the new uid", async () => {
    const { provider, calls } = stubProvider({});
    expect(await provider.moveMessage("INBOX", 5, "AI")).toEqual({ newUid: 9 });
    expect(calls).toEqual(["copy", "delete"]);
  });

  test("the COPY path throws expunge refused when the delete fails", async () => {
    const { provider } = stubProvider({ deleted: false });
    await expect(provider.moveMessage("INBOX", 5, "AI")).rejects.toThrow(new HardError("expunge refused"));
  });

  test("without live MOVE, messageMove is never called", async () => {
    const { provider, calls } = stubProvider({ capabilities: ["UIDPLUS"] });
    await provider.moveMessage("INBOX", 5, "AI");
    expect(calls).not.toContain("move");
  });

  test("forceCopyMove ignores a live MOVE", async () => {
    const { provider, calls } = stubProvider({ capabilities: ["MOVE", "UIDPLUS"] }, true);
    await provider.moveMessage("INBOX", 5, "AI");
    expect(calls).toEqual(["copy", "delete"]);
  });

  test("live MOVE uses messageMove; false is move refused", async () => {
    const ok = stubProvider({ capabilities: ["MOVE", "UIDPLUS"] });
    expect(await ok.provider.moveMessage("INBOX", 5, "AI")).toEqual({ newUid: 9 });
    expect(ok.calls).toEqual(["move"]);
    const refused = stubProvider({ capabilities: ["MOVE"], move: false });
    await expect(refused.provider.moveMessage("INBOX", 5, "AI")).rejects.toThrow(new HardError("move refused"));
  });

  test("the COPY path without UIDPLUS throws before any write", async () => {
    const { provider, calls } = stubProvider({ capabilities: [] });
    await expect(provider.moveMessage("INBOX", 5, "AI")).rejects.toThrow(new HardError("no UIDPLUS"));
    expect(calls).toEqual([]);
  });

  test("the COPY path throws expunge refused when the UID is still in the folder", async () => {
    const { provider } = stubProvider({ survivesDelete: true });
    await expect(provider.moveMessage("INBOX", 5, "AI")).rejects.toThrow(new HardError("expunge refused"));
  });

  test("deleteMessage throws expunge refused when the UID is still in the folder", async () => {
    const { provider } = stubProvider({ survivesDelete: true });
    await expect(provider.deleteMessage("INBOX", 5)).rejects.toThrow(new HardError("expunge refused"));
  });

  test("the COPY path with an unconfirmed COPY (undefined) never deletes", async () => {
    const { provider, calls } = stubProvider({ copy: undefined });
    await expect(provider.moveMessage("INBOX", 5, "AI")).rejects.toThrow(new HardError("copy refused"));
    expect(calls).toEqual(["copy"]);
  });

  test("live MOVE: undefined is move refused", async () => {
    const { provider } = stubProvider({ capabilities: ["MOVE"], move: undefined });
    await expect(provider.moveMessage("INBOX", 5, "AI")).rejects.toThrow(new HardError("move refused"));
  });

  test("setFlags: a false remove is flag store refused", async () => {
    const { provider } = stubProvider({ flagsRemove: false });
    await expect(provider.setFlags("INBOX", 5, { remove: ["\\Seen"] })).rejects.toThrow(
      new HardError("flag store refused")
    );
  });

  test("fetchMetaIn drops a meta whose uid is not the asked uid", async () => {
    const { provider } = stubProvider({ fetchedUid: 7 });
    expect(await provider.fetchMetaIn("INBOX", 5)).toBeNull();
  });

  test("searchSinceIn: a failed SEARCH is a SoftError, not an empty list", async () => {
    const failed = stubProvider({ search: false });
    await expect(failed.provider.searchSinceIn("INBOX", new Date())).rejects.toBeInstanceOf(SoftError);
    expect(await stubProvider({ search: [3, 4] }).provider.searchSinceIn("INBOX", new Date())).toEqual([3, 4]);
  });

  test("setFlags: a false store is flag store refused", async () => {
    const { provider } = stubProvider({ flagsAdd: false });
    await expect(provider.setFlags("INBOX", 5, { add: ["\\Seen"] })).rejects.toThrow(
      new HardError("flag store refused")
    );
  });
});
