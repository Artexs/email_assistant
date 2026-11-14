import { afterEach, describe, expect, test } from "bun:test";

import {
  INBOX,
  locateMessage,
  MailFolderMissingError,
  MailNotFoundError,
  sameMailIdentity,
  type MailIdentity,
  type MailProvider,
  type MessageMeta,
  renderSeedMessage,
  type SeedMessage,
} from "../../src/modules/mail";
import { contentHash, normalizeMessageId } from "../../src/modules/mail/sync-rules";
import { HardError } from "../../src/platform/errors";

export interface ContractEnv {
  provider: MailProvider;
  seed(folder: string, msg: SeedMessage): Promise<void>;
  cleanup(): Promise<void>;
}

const DAY_MS = 86_400_000;

function mail(n: number, extra: Partial<SeedMessage> = {}): SeedMessage {
  return {
    messageId: `<contract-${n}@example.test>`,
    from: "boss@example.test",
    to: ["me@example.test"],
    subject: `Contract ${n}`,
    date: new Date(),
    text: `Body number ${n}`,
    ...extra,
  };
}

function identityOf(meta: MessageMeta): MailIdentity {
  return {
    messageId: normalizeMessageId(meta.messageId),
    contentHash: contentHash(meta),
    from: meta.from,
    receivedAt: meta.internalDate,
  };
}

/** Runs the same cases on every `MailProvider` (fake and IMAP adapter). */
export function describeMailProviderContract(name: string, makeEnv: () => Promise<ContractEnv>): void {
  describe(`MailProvider contract: ${name}`, () => {
    const envs: ContractEnv[] = [];

    async function freshEnv(): Promise<ContractEnv> {
      const env = await makeEnv();
      envs.push(env);
      return env;
    }

    afterEach(async () => {
      while (envs.length > 0) await envs.pop()?.cleanup();
    });

    test("folderStatus(INBOX) gives uidValidity, highestUid and a uidNext above it", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      await seed("INBOX", mail(2));
      const last = (await provider.fetchAbove(INBOX, 0)).at(-1)?.uid ?? 0;
      const status = await provider.folderStatus(INBOX);
      expect(status.uidValidity).toBeGreaterThan(0);
      expect(status.highestUid).toBe(last);
      expect(status.uidNext).toBeGreaterThan(status.highestUid);
    });

    test("folderStatus of a seeded folder gives its last uid; an empty folder gives highestUid 0", async () => {
      const { provider, seed } = await freshEnv();
      const oferty = await provider.ensureFolder("Oferty");
      await seed(oferty, mail(1));
      await seed(oferty, mail(2));
      const last = (await provider.fetchAbove(oferty, 0)).at(-1)?.uid ?? 0;
      expect((await provider.folderStatus(oferty)).highestUid).toBe(last);
      const empty = await provider.ensureFolder(`Empty-${crypto.randomUUID()}`);
      const status = await provider.folderStatus(empty);
      expect(status.highestUid).toBe(0);
      expect(status.uidNext).toBeGreaterThanOrEqual(1);
    });

    test("a missing folder gives MailFolderMissingError in every folder read; INBOX works after it", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      const missing = `Nope-${crypto.randomUUID()}`;
      await expect(provider.folderStatus(missing)).rejects.toBeInstanceOf(MailFolderMissingError);
      await expect(provider.fetchAbove(missing, 0)).rejects.toBeInstanceOf(MailFolderMissingError);
      await expect(provider.fetchContent(missing, 1)).rejects.toBeInstanceOf(MailFolderMissingError);
      expect(await provider.fetchAbove(INBOX, 0)).toHaveLength(1);
    });

    test("fetchAbove and fetchContent read the asked folder only; an unknown uid gives null", async () => {
      const { provider, seed } = await freshEnv();
      const oferty = await provider.ensureFolder("Oferty");
      await seed("INBOX", mail(1));
      await seed(oferty, mail(2, { text: "Offer text" }));
      await seed(oferty, mail(3));
      const metas = await provider.fetchAbove(oferty, 0);
      expect(metas.map((m) => m.messageId)).toEqual(["<contract-2@example.test>", "<contract-3@example.test>"]);
      const uids = metas.map((m) => m.uid);
      expect(uids).toEqual([...uids].sort((a, b) => a - b));
      expect((await provider.fetchContent(oferty, uids[0] ?? 0)).text).toContain("Offer text");
      expect((await provider.fetchContent(INBOX, 999_999)).text).toBeNull();
    });

    test("listFolders lists INBOX and created folders with a delimiter", async () => {
      const { provider } = await freshEnv();
      const created = await provider.ensureFolder("Oferty");
      const folders = await provider.listFolders();
      expect(folders.map((f) => f.path)).toContain(INBOX);
      expect(folders.map((f) => f.path)).toContain(created);
      for (const folder of folders) expect(folder.delimiter).toMatch(/^[/.]$/);
    });

    test("fetchAbove(0) returns the seeded mails in ascending uid order with their fields", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1, { cc: ["cc@example.test"] }));
      await seed(
        "INBOX",
        mail(2, {
          inReplyTo: "<contract-1@example.test>",
          references: ["<root@example.test>", "<contract-1@example.test>"],
        })
      );
      await seed("INBOX", mail(3, { headers: { "X-EA-Action-Id": "act-1" } }));

      const metas = await provider.fetchAbove(INBOX, 0);
      expect(metas).toHaveLength(3);
      const uids = metas.map((m) => m.uid);
      expect(uids).toEqual([...uids].sort((a, b) => a - b));
      expect(metas.map((m) => m.messageId)).toEqual([
        "<contract-1@example.test>",
        "<contract-2@example.test>",
        "<contract-3@example.test>",
      ]);
      expect(metas[0]?.from).toContain("boss@example.test");
      expect(metas[0]?.to.join(",")).toContain("me@example.test");
      expect(metas[0]?.cc.join(",")).toContain("cc@example.test");
      expect(metas[0]?.subject).toBe("Contract 1");
      expect(metas[0]?.actionId).toBeNull();
      expect(metas[1]?.inReplyTo).toBe("<contract-1@example.test>");
      expect(metas[1]?.references).toEqual(["<root@example.test>", "<contract-1@example.test>"]);
      expect(metas[2]?.actionId).toBe("act-1");
    });

    test("fetchAbove(maxUid) returns no uid above maxUid", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      await seed("INBOX", mail(2));
      const maxUid = Math.max(...(await provider.fetchAbove(INBOX, 0)).map((m) => m.uid));
      const metas = await provider.fetchAbove(INBOX, maxUid);
      expect(metas.filter((m) => m.uid > maxUid)).toHaveLength(0);
    });

    test("fetchByUids returns the asked uids", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      await seed("INBOX", mail(2));
      await seed("INBOX", mail(3));
      const all = await provider.fetchAbove(INBOX, 0);
      const asked = [all[0]?.uid ?? 0, all[2]?.uid ?? 0];
      const metas = await provider.fetchByUidsIn(INBOX, asked);
      expect(metas.map((m) => m.uid).sort((a, b) => a - b)).toEqual(asked);
    });

    test("searchSinceIn(INBOX, yesterday) contains all seeded uids", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      await seed("INBOX", mail(2));
      const all = (await provider.fetchAbove(INBOX, 0)).map((m) => m.uid);
      const found = await provider.searchSinceIn(INBOX, new Date(Date.now() - DAY_MS));
      for (const uid of all) expect(found).toContain(uid);
    });

    test("fetchContent returns the text of a text mail", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1, { text: "Please approve the budget" }));
      const [meta] = await provider.fetchAbove(INBOX, 0);
      const body = (await provider.fetchContent(INBOX, meta?.uid ?? 0)).text;
      expect(body).toContain("Please approve the budget");
    });

    test("fetchContent returns the visible text of an html-only mail without tags", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1, { text: undefined, html: "<p>Visible words</p>" }));
      const [meta] = await provider.fetchAbove(INBOX, 0);
      const body = (await provider.fetchContent(INBOX, meta?.uid ?? 0)).text;
      expect(body).toContain("Visible words");
      expect(body).not.toContain("<p>");
    });

    test("fetchContent captures Reply-To and List-Unsubscribe", async () => {
      const { provider, seed } = await freshEnv();
      await seed(
        "INBOX",
        mail(1, {
          headers: { "Reply-To": "Desk <desk@example.test>", "List-Unsubscribe": "<https://u.example.test/x>" },
        })
      );
      const [meta] = await provider.fetchAbove(INBOX, 0);
      const content = await provider.fetchContent(INBOX, meta?.uid ?? 0);
      expect(content.capture?.replyTo).toEqual(["desk@example.test"]);
      expect(content.capture?.listUnsubscribe).toBe("<https://u.example.test/x>");
      expect(content.capture?.partsKnown).toBe(true);
    });

    test("fetchContent of an unknown uid gives no text and no capture", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      expect(await provider.fetchContent(INBOX, 999_999)).toEqual({ text: null, capture: null });
    });

    test("fetchFlagsIn gives the flags and the identity of the asked uids, ascending; unknown uids are left out", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      await seed("INBOX", mail(2));
      const [a, b] = await provider.fetchAbove(INBOX, 0);
      const uidA = a?.uid ?? 0;
      const uidB = b?.uid ?? 0;
      await provider.setFlags(INBOX, uidA, { add: ["\\Seen", "\\Answered"] });
      const found = await provider.fetchFlagsIn(INBOX, [uidB, uidA, 999_999]);
      expect(found.map((entry) => entry.uid)).toEqual([uidA, uidB]);
      expect(found[0]?.flags).toContain("\\Seen");
      expect(found[0]?.flags).toContain("\\Answered");
      expect(found[1]?.flags).not.toContain("\\Answered");
      expect(found.map((entry) => entry.messageId)).toEqual(["<contract-1@example.test>", "<contract-2@example.test>"]);
      expect(found[0]?.internalDate).toBeInstanceOf(Date);
    });

    test("fetchFlagsIn gives [] for no uids and for a missing folder", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      expect(await provider.fetchFlagsIn(INBOX, [])).toEqual([]);
      expect(await provider.fetchFlagsIn("No/Such", [1])).toEqual([]);
    });

    test("a mail without messageId gives messageId null", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1, { messageId: undefined }));
      const [meta] = await provider.fetchAbove(INBOX, 0);
      expect(meta?.messageId).toBeNull();
    });

    test("fetchMetaIn in another folder keeps the identity; locateMessage finds the moved mail without a hint", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(7));
      const [source] = await provider.fetchAbove(INBOX, 0);
      if (source === undefined) throw new Error("seed failed");
      const key = identityOf(source);
      const folder = await provider.ensureFolder(`AI/Contract-${crypto.randomUUID()}`);
      const { newUid } = await provider.moveMessage("INBOX", source.uid, folder);

      const found = await locateMessage(provider, folder, { ...key, hintUid: null });
      expect(found).not.toBeNull();
      if (newUid !== null) expect(found?.uid).toBe(newUid);
      const same = await provider.fetchMetaIn(folder, found?.uid ?? 0);
      expect(same !== null && sameMailIdentity(same, key)).toBe(true);
      const hinted = await locateMessage(provider, folder, { ...key, hintUid: found?.uid ?? null });
      expect(hinted?.uid).toBe(found?.uid ?? -1);
    });

    test("locateMessage gives null for a mail that is not in the folder, was deleted, or has a missing folder", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(8));
      const [source] = await provider.fetchAbove(INBOX, 0);
      if (source === undefined) throw new Error("seed failed");
      const key = { ...identityOf(source), hintUid: null };
      const folder = await provider.ensureFolder(`AI/Contract-${crypto.randomUUID()}`);
      expect(await locateMessage(provider, folder, key)).toBeNull();
      expect(await locateMessage(provider, "No-such-folder", key)).toBeNull();
      const { newUid } = await provider.moveMessage("INBOX", source.uid, folder);
      const uid = newUid ?? (await provider.searchSinceIn(folder, new Date(Date.now() - DAY_MS)))[0] ?? 0;
      expect(await provider.deleteMessage(folder, uid)).toBe(true);
      expect(await locateMessage(provider, folder, { ...key, hintUid: uid })).toBeNull();
    });

    const yesterday = () => new Date(Date.now() - DAY_MS);

    test("ensureFolder creates the folder and a second call returns the same path", async () => {
      const { provider } = await freshEnv();
      const path = await provider.ensureFolder(`AI/Contract-${crypto.randomUUID()}`);
      const listed = (await provider.serverInfo()).folders.map((f) => f.path);
      expect(listed).toContain(path);
      expect(await provider.ensureFolder(path)).toBe(path);
      const after = (await provider.serverInfo()).folders.map((f) => f.path);
      expect(after).toHaveLength(listed.length);
    });

    test("fetchMetaIn matches fetchAbove and has no \\Seen; null for unknown uid or folder", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      const [expected] = await provider.fetchAbove(INBOX, 0);
      const uid = expected?.uid ?? 0;
      const meta = await provider.fetchMetaIn("INBOX", uid);
      expect(meta?.messageId).toBe(expected?.messageId ?? "missing");
      expect(meta?.from).toBe(expected?.from ?? "missing");
      expect(meta?.subject).toBe(expected?.subject ?? "missing");
      expect(meta?.size).toBe(expected?.size ?? -1);
      expect(meta?.internalDate.getTime()).toBe(expected?.internalDate.getTime() ?? -1);
      expect(meta?.flags).not.toContain("\\Seen");
      expect(await provider.fetchMetaIn("INBOX", 999999)).toBeNull();
      expect(await provider.fetchMetaIn("No-such-folder", 1)).toBeNull();
    });

    test("setFlags adds and removes flags", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      const uid = (await provider.fetchAbove(INBOX, 0))[0]?.uid ?? 0;
      await provider.setFlags("INBOX", uid, { add: ["\\Seen", "\\Flagged"] });
      const both = await provider.fetchMetaIn("INBOX", uid);
      expect(both?.flags).toContain("\\Seen");
      expect(both?.flags).toContain("\\Flagged");
      await provider.setFlags("INBOX", uid, { remove: ["\\Flagged"] });
      const one = await provider.fetchMetaIn("INBOX", uid);
      expect(one?.flags).toContain("\\Seen");
      expect(one?.flags).not.toContain("\\Flagged");
    });

    test("moveMessage moves the mail with its fields and flags", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      const [source] = await provider.fetchAbove(INBOX, 0);
      const uid = source?.uid ?? 0;
      await provider.setFlags("INBOX", uid, { add: ["\\Seen"] });
      const folder = await provider.ensureFolder(`AI/Contract-${crypto.randomUUID()}`);
      const { newUid } = await provider.moveMessage("INBOX", uid, folder);
      expect(await provider.fetchMetaIn("INBOX", uid)).toBeNull();
      const found =
        newUid === null
          ? await provider.fetchByUidsIn(folder, await provider.searchSinceIn(folder, yesterday()))
          : await provider.fetchByUidsIn(folder, [newUid]);
      expect(found).toHaveLength(1);
      expect(found[0]?.messageId).toBe(source?.messageId ?? "missing");
      expect(found[0]?.size).toBe(source?.size ?? -1);
      expect(found[0]?.internalDate.getTime()).toBe(source?.internalDate.getTime() ?? -1);
      expect(found[0]?.flags).toContain("\\Seen");
    });

    test("moveMessage of an unknown uid throws MailNotFoundError", async () => {
      const { provider } = await freshEnv();
      const folder = await provider.ensureFolder(`AI/Contract-${crypto.randomUUID()}`);
      await expect(provider.moveMessage("INBOX", 999999, folder)).rejects.toBeInstanceOf(MailNotFoundError);
    });

    test("searchSinceIn lists the moved uid; [] for a missing folder", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      const uid = (await provider.fetchAbove(INBOX, 0))[0]?.uid ?? 0;
      const folder = await provider.ensureFolder(`AI/Contract-${crypto.randomUUID()}`);
      const { newUid } = await provider.moveMessage("INBOX", uid, folder);
      const found = await provider.searchSinceIn(folder, yesterday());
      expect(found).toHaveLength(1);
      if (newUid !== null) expect(found).toContain(newUid);
      expect(await provider.searchSinceIn("No-such-folder", yesterday())).toEqual([]);
    });

    test("deleteMessage deletes one mail; a second call gives false", async () => {
      const { provider, seed } = await freshEnv();
      const folder = await provider.ensureFolder(`AI/Contract-${crypto.randomUUID()}`);
      await seed(folder, mail(1));
      await seed(folder, mail(2));
      const [first, second] = await provider.fetchByUidsIn(folder, await provider.searchSinceIn(folder, yesterday()));
      const uid = first?.uid ?? 0;
      expect(await provider.deleteMessage(folder, uid)).toBe(true);
      expect(await provider.fetchMetaIn(folder, uid)).toBeNull();
      expect(await provider.deleteMessage(folder, uid)).toBe(false);
      expect((await provider.fetchMetaIn(folder, second?.uid ?? 0))?.messageId).toBe(second?.messageId ?? "missing");
    });

    test("after a move fetchAbove(lastUid) does not return the moved uid as new", async () => {
      const { provider, seed } = await freshEnv();
      await seed("INBOX", mail(1));
      await seed("INBOX", mail(2));
      const [first, second] = await provider.fetchAbove(INBOX, 0);
      const lastUid = second?.uid ?? 0;
      const folder = await provider.ensureFolder(`AI/Contract-${crypto.randomUUID()}`);
      await provider.moveMessage("INBOX", first?.uid ?? 0, folder);
      const metas = await provider.fetchAbove(INBOX, lastUid);
      expect(metas.filter((m) => m.uid > lastUid)).toHaveLength(0);
      expect(metas.map((m) => m.uid)).not.toContain(first?.uid ?? 0);
    });

    function outgoing(n: number, date: Date): { raw: Buffer; messageId: string; actionId: string } {
      const messageId = `<ea-append-${n}-${crypto.randomUUID()}@example.test>`;
      const actionId = crypto.randomUUID();
      const text = renderSeedMessage({
        messageId,
        from: "me@example.test",
        to: ["jan@example.test"],
        subject: `Append ${n}`,
        date,
        text: "Body",
        headers: { "X-EA-Action-Id": actionId },
      });
      return { raw: Buffer.from(text), messageId, actionId };
    }

    test("appendMessage stores the raw with its flags, date, size and action id", async () => {
      const { provider } = await freshEnv();
      const folder = await provider.ensureFolder(`Drafts-${crypto.randomUUID()}`);
      const date = new Date(Math.floor(Date.now() / 1000) * 1000);
      const { raw, messageId, actionId } = outgoing(1, date);
      const { uid } = await provider.appendMessage(folder, raw, ["\\Draft"], date);
      expect(uid).toBeGreaterThan(0);
      const meta = await provider.fetchMetaIn(folder, uid ?? 0);
      expect(meta?.actionId).toBe(actionId);
      expect(meta?.messageId).toBe(messageId);
      expect(meta?.internalDate.getTime()).toBe(date.getTime());
      expect(meta?.size).toBe(raw.byteLength);
      expect(meta?.flags).toContain("\\Draft");
      expect(await provider.searchSinceIn(folder, new Date(date.getTime() - DAY_MS))).toContain(uid ?? 0);
    });

    test("appendMessage then deleteMessage removes the appended mail", async () => {
      const { provider } = await freshEnv();
      const folder = await provider.ensureFolder(`Sent-${crypto.randomUUID()}`);
      const date = new Date(Math.floor(Date.now() / 1000) * 1000);
      const { uid } = await provider.appendMessage(folder, outgoing(2, date).raw, ["\\Seen"], date);
      expect(await provider.deleteMessage(folder, uid ?? 0)).toBe(true);
      expect(await provider.fetchMetaIn(folder, uid ?? 0)).toBeNull();
    });

    test("appendMessage to a missing folder throws a HardError", async () => {
      const { provider } = await freshEnv();
      const date = new Date();
      await expect(
        provider.appendMessage(`No-such-folder-${crypto.randomUUID()}`, outgoing(3, date).raw, [], date)
      ).rejects.toBeInstanceOf(HardError);
    });

    async function transferred(
      provider: MailProvider,
      folder: string,
      newUid: number | null
    ): Promise<Awaited<ReturnType<MailProvider["fetchByUidsIn"]>>> {
      return newUid === null
        ? provider.fetchByUidsIn(folder, await provider.searchSinceIn(folder, yesterday()))
        : provider.fetchByUidsIn(folder, [newUid]);
    }

    test("transferByAppend moves the mail with its size, date, Message-ID and flags (test 1, 2, 7b)", async () => {
      const { provider, seed } = await freshEnv();
      const oferty = await provider.ensureFolder("Oferty");
      await seed(oferty, mail(1));
      const [source] = await provider.fetchAbove(oferty, 0);
      if (source === undefined) throw new Error("seed failed");
      await provider.setFlags(oferty, source.uid, { add: ["\\Seen", "\\Flagged"] });

      const { newUid } = await provider.transferByAppend(oferty, source.uid, INBOX);

      expect(newUid).not.toBeNull();
      const inbox = await provider.fetchByUidsIn(INBOX, [newUid ?? 0]);
      expect(inbox).toHaveLength(1);
      expect(await provider.fetchAbove(INBOX, 0)).toHaveLength(1);
      const copy = inbox[0];
      if (copy === undefined) throw new Error("no copy");
      expect(copy.uid).toBe(newUid ?? 0);
      expect(copy.size).toBe(source.size);
      expect(Math.floor(copy.internalDate.getTime() / 1000)).toBe(Math.floor(source.internalDate.getTime() / 1000));
      expect(copy.messageId).toBe(source.messageId ?? "missing");
      expect(copy.flags).toContain("\\Seen");
      expect(copy.flags).toContain("\\Flagged");
      expect(await provider.fetchMetaIn(oferty, source.uid)).toBeNull();
      expect(await provider.fetchAbove(oferty, 0)).toEqual([]);
      expect(sameMailIdentity(copy, identityOf(source))).toBe(true);
    }, 10_000);

    test("transferByAppend of an unknown uid or from a missing folder throws MailNotFoundError and writes nothing (test 3)", async () => {
      const { provider, seed } = await freshEnv();
      const oferty = await provider.ensureFolder("Oferty");
      await seed(oferty, mail(1));
      await expect(provider.transferByAppend(oferty, 999_999, INBOX)).rejects.toBeInstanceOf(MailNotFoundError);
      await expect(provider.transferByAppend(`Nope-${crypto.randomUUID()}`, 1, INBOX)).rejects.toBeInstanceOf(
        MailNotFoundError
      );
      expect(await provider.fetchAbove(INBOX, 0)).toEqual([]);
      expect(await provider.fetchAbove(oferty, 0)).toHaveLength(1);
    }, 10_000);

    test("transferByAppend between two sort folders keeps size, date and Message-ID (test 9, U11)", async () => {
      const { provider, seed } = await freshEnv();
      const info = await provider.ensureFolder("AI/Info");
      const oferty = await provider.ensureFolder("Oferty");
      await seed(info, mail(1));
      const [source] = await provider.fetchAbove(info, 0);
      if (source === undefined) throw new Error("seed failed");

      const { newUid } = await provider.transferByAppend(info, source.uid, oferty);

      const target = await transferred(provider, oferty, newUid);
      expect(target).toHaveLength(1);
      expect(target[0]?.size).toBe(source.size);
      expect(Math.floor((target[0]?.internalDate.getTime() ?? 0) / 1000)).toBe(
        Math.floor(source.internalDate.getTime() / 1000)
      );
      expect(target[0]?.messageId).toBe(source.messageId ?? "missing");
      expect(await provider.fetchAbove(info, 0)).toEqual([]);
    }, 10_000);

    test("serverInfo lists INBOX", async () => {
      const { provider } = await freshEnv();
      const info = await provider.serverInfo();
      expect(info.folders.map((f) => f.path)).toContain("INBOX");
    });
  });
}
