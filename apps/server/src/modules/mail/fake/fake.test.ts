import { describe, expect, test } from "bun:test";

import { describeMailProviderContract } from "../../../../test/contract/mail-provider";
import { describeError, HardError, SoftError } from "../../../platform/errors";
import { INBOX, MailFolderMissingError, MailNotFoundError } from "../port";
import type { SeedMessage } from "../seed";

import { createFakeMailProvider } from "./index";

function mail(n: number): SeedMessage {
  return {
    messageId: `<fake-${n}@example.test>`,
    from: "boss@example.test",
    to: ["me@example.test"],
    subject: `Fake ${n}`,
    date: new Date("2026-11-03T10:00:00Z"),
    text: `Body ${n}`,
  };
}

describeMailProviderContract("fake", async () => {
  const provider = createFakeMailProvider();
  return {
    provider,
    seed: async (folder, msg) => {
      provider.deliver(folder, msg);
    },
    cleanup: () => Promise.resolve(),
  };
});

describeMailProviderContract("fake-copy-path", async () => {
  const provider = createFakeMailProvider({ capabilities: { move: false, uidplus: true } });
  return {
    provider,
    seed: async (folder, msg) => {
      provider.deliver(folder, msg);
    },
    cleanup: () => Promise.resolve(),
  };
});

describe("fake provider", () => {
  test("userMove gives a new uid in the target folder and removes the source", async () => {
    const fake = createFakeMailProvider();
    const uid = fake.deliver(INBOX, mail(1));
    const newUid = fake.userMove(INBOX, uid, "Archive");
    expect(newUid).toBe(1);
    expect(await fake.fetchByUidsIn(INBOX, [uid])).toHaveLength(0);
    expect((await fake.fetchMetaIn("Archive", newUid))?.messageId).toBe("<fake-1@example.test>");
  });

  test("resetUidValidity renumbers INBOX from 1 in the old order", async () => {
    const fake = createFakeMailProvider({ uidValidity: 5 });
    fake.deliver(INBOX, mail(1));
    const second = fake.deliver(INBOX, mail(2));
    const third = fake.deliver(INBOX, mail(3));
    fake.remove(INBOX, second);
    expect(third).toBe(3);
    fake.resetUidValidity(9);
    expect(await fake.folderStatus(INBOX)).toEqual({ uidValidity: 9, uidNext: 3, highestUid: 2 });
    const metas = await fake.fetchAbove(INBOX, 0);
    expect(metas.map((m) => [m.uid, m.messageId])).toEqual([
      [1, "<fake-1@example.test>"],
      [2, "<fake-3@example.test>"],
    ]);
  });

  test("uidNextValue 1 (Interia) still gives highestUid + 1 as uidNext", async () => {
    const fake = createFakeMailProvider({ uidNextValue: 1 });
    for (let n = 1; n <= 3; n++) fake.deliver("Oferty", mail(n));
    expect(await fake.folderStatus("Oferty")).toEqual({ uidValidity: 1, uidNext: 4, highestUid: 3 });
  });

  test("globalUids uses one UID counter for all folders", async () => {
    const fake = createFakeMailProvider({ globalUids: true });
    expect(fake.deliver(INBOX, mail(1))).toBe(1);
    expect(fake.deliver("Oferty", mail(2))).toBe(2);
    expect(fake.deliver(INBOX, mail(3))).toBe(3);
    const raw = Buffer.from("Message-ID: <a@x.test>\r\nFrom: a@x.test\r\nTo: b@x.test\r\nSubject: s\r\n\r\nbody");
    await fake.ensureFolder("AI/Info");
    expect((await fake.appendMessage("AI/Info", raw, [], new Date("2026-11-03T10:00:00Z"))).uid).toBe(4);
  });

  test("globalUids renumbers a reset folder from the shared counter", async () => {
    const fake = createFakeMailProvider({ globalUids: true });
    fake.deliver(INBOX, mail(1));
    fake.deliver("Oferty", mail(2));
    fake.deliver("Oferty", mail(3));
    fake.resetUidValidity(7, "Oferty");
    expect((await fake.fetchAbove("Oferty", 0)).map((m) => m.uid)).toEqual([4, 5]);
    expect((await fake.folderStatus("Oferty")).uidValidity).toBe(7);
  });

  test("resetUidValidity(9, folder) leaves INBOX unchanged", async () => {
    const fake = createFakeMailProvider({ uidValidity: 5 });
    fake.deliver(INBOX, mail(1));
    fake.deliver("Oferty", mail(2));
    fake.resetUidValidity(9, "Oferty");
    expect((await fake.folderStatus("Oferty")).uidValidity).toBe(9);
    expect((await fake.folderStatus(INBOX)).uidValidity).toBe(5);
  });

  test("folderCalls records the folder of each call; a missing folder error has a fixed message", async () => {
    const fake = createFakeMailProvider();
    fake.deliver("Oferty", mail(1));
    fake.deliver(INBOX, mail(2));
    await fake.fetchAbove("Oferty", 0);
    await fake.fetchByUidsIn(INBOX, [1]);
    expect(fake.folderCalls.slice(-2)).toEqual([
      { method: "fetchAbove", folder: "Oferty" },
      { method: "fetchByUidsIn", folder: INBOX },
    ]);
    const error = await fake.folderStatus("Secret/Path").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MailFolderMissingError);
    expect((error as Error).message).toBe("IMAP folder not found");
  });

  test("failOn throws once, then the call works", async () => {
    const fake = createFakeMailProvider();
    fake.failOn("folderStatus", new SoftError("lost connection"));
    await expect(fake.folderStatus(INBOX)).rejects.toBeInstanceOf(SoftError);
    expect((await fake.folderStatus(INBOX)).uidNext).toBe(1);
    expect(fake.calls).toEqual(["folderStatus", "folderStatus"]);
  });

  test("star quirk on returns the highest uid at or below the cursor; off returns nothing", async () => {
    const on = createFakeMailProvider();
    on.deliver(INBOX, mail(1));
    const top = on.deliver(INBOX, mail(2));
    expect((await on.fetchAbove(INBOX, top)).map((m) => m.uid)).toEqual([top]);

    const off = createFakeMailProvider({ starQuirk: false });
    off.deliver(INBOX, mail(1));
    const offTop = off.deliver(INBOX, mail(2));
    expect(await off.fetchAbove(INBOX, offTop)).toEqual([]);
  });

  test("close sets closed", async () => {
    const fake = createFakeMailProvider();
    await fake.close();
    expect(fake.closed).toBe(true);
  });

  test("fetchBodyText gives null when the size is over bodyLimitBytes", async () => {
    const fake = createFakeMailProvider({ bodyLimitBytes: 10 });
    const uid = fake.deliver(INBOX, mail(1), { size: 11 });
    expect(await fake.fetchBodyText(INBOX, uid)).toBeNull();
  });

  test("MailNotFoundError has its own name that describeError prints", () => {
    const error = new MailNotFoundError("x");
    expect(error.name).toBe("MailNotFoundError");
    expect(error).toBeInstanceOf(HardError);
    expect(describeError(error)).toBe("MailNotFoundError");
  });

  test("moveMessage gives a new uid by default and the source uid with keepUidOnCopy", async () => {
    const plain = createFakeMailProvider();
    plain.deliver("Target", mail(9));
    const plainUid = plain.deliver(INBOX, mail(1));
    expect((await plain.moveMessage(INBOX, plainUid, "Target")).newUid).toBe(2);

    const keeping = createFakeMailProvider({ keepUidOnCopy: true });
    keeping.deliver(INBOX, mail(8));
    await keeping.ensureFolder("Target");
    const keptUid = keeping.deliver(INBOX, mail(1));
    expect((await keeping.moveMessage(INBOX, keptUid, "Target")).newUid).toBe(keptUid);
    // The UID is taken in the target now, so the next copy gets the next UID.
    const other = keeping.deliver(INBOX, mail(2));
    keeping.deliver("Target", mail(3));
    expect((await keeping.moveMessage(INBOX, other, "Target")).newUid).not.toBe(other);
  });

  test("copyUidMap false gives newUid null; the mail is still moved", async () => {
    const fake = createFakeMailProvider({ copyUidMap: false });
    const uid = fake.deliver(INBOX, mail(1));
    await fake.ensureFolder("Target");
    expect(await fake.moveMessage(INBOX, uid, "Target")).toEqual({ newUid: null });
    expect(await fake.fetchMetaIn(INBOX, uid)).toBeNull();
    expect(await fake.searchSinceIn("Target", new Date("2026-01-01T00:00:00Z"))).toHaveLength(1);
  });

  test("moveMessage without MOVE copies, deletes the source and keeps the flags", async () => {
    const fake = createFakeMailProvider({ capabilities: { move: false, uidplus: true } });
    const uid = fake.deliver(INBOX, mail(1));
    await fake.ensureFolder("Target");
    await fake.setFlags(INBOX, uid, { add: ["\\Seen"] });
    const { newUid } = await fake.moveMessage(INBOX, uid, "Target");
    expect(await fake.fetchMetaIn(INBOX, uid)).toBeNull();
    expect((await fake.fetchMetaIn("Target", newUid ?? 0))?.flags).toEqual(["\\Seen"]);
    expect(fake.calls).toEqual(["ensureFolder", "setFlags", "moveMessage", "fetchMetaIn", "fetchMetaIn"]);
  });

  test("failOn deleteMessage stops the copy path after the copy", async () => {
    const fake = createFakeMailProvider({ capabilities: { move: false, uidplus: true } });
    const uid = fake.deliver(INBOX, mail(1));
    await fake.ensureFolder("Target");
    fake.failOn("deleteMessage", new SoftError("lost"));
    await expect(fake.moveMessage(INBOX, uid, "Target")).rejects.toBeInstanceOf(SoftError);
    expect(await fake.fetchMetaIn(INBOX, uid)).not.toBeNull();
    expect(await fake.searchSinceIn("Target", new Date("2026-01-01T00:00:00Z"))).toHaveLength(1);
    expect(fake.calls).not.toContain("deleteMessage");
  });

  test("moveMessage with move false and uidplus false throws HardError and keeps the mail in the source", async () => {
    const fake = createFakeMailProvider({ capabilities: { move: false, uidplus: false } });
    const uid = fake.deliver(INBOX, mail(1));
    await fake.ensureFolder("Target");
    await expect(fake.moveMessage(INBOX, uid, "Target")).rejects.toBeInstanceOf(HardError);
    expect(await fake.fetchMetaIn(INBOX, uid)).not.toBeNull();
    expect(await fake.searchSinceIn("Target", new Date("2026-01-01T00:00:00Z"))).toEqual([]);
    // The not-found check comes first.
    await expect(fake.moveMessage(INBOX, 99, "Target")).rejects.toBeInstanceOf(MailNotFoundError);
  });

  test("moveMessage with move true and uidplus false works and gives newUid null", async () => {
    const fake = createFakeMailProvider({ capabilities: { move: true, uidplus: false } });
    const uid = fake.deliver(INBOX, mail(1));
    await fake.ensureFolder("Target");
    expect(await fake.moveMessage(INBOX, uid, "Target")).toEqual({ newUid: null });
    expect(await fake.fetchMetaIn(INBOX, uid)).toBeNull();
  });

  test("moveMessage to a folder that does not exist throws HardError and keeps the mail", async () => {
    const fake = createFakeMailProvider();
    const uid = fake.deliver(INBOX, mail(1));
    await expect(fake.moveMessage(INBOX, uid, "Nowhere")).rejects.toBeInstanceOf(HardError);
    expect(await fake.fetchMetaIn(INBOX, uid)).not.toBeNull();
  });

  test("keepUidOnCopy and keepUidOnUserMove are separate (Interia: copy false, user move true)", async () => {
    const fake = createFakeMailProvider({ keepUidOnUserMove: true });
    fake.deliver("Target", mail(8));
    fake.deliver("Target", mail(9));
    const uid = fake.deliver(INBOX, mail(1));
    expect(fake.userMove(INBOX, uid, "Other")).toBe(uid);
    const second = fake.deliver(INBOX, mail(2));
    expect((await fake.moveMessage(INBOX, second, "Target")).newUid).not.toBe(second);
  });

  test("ensureFolder uses the exact path, then a case-insensitive match, and applies pathDelimiter", async () => {
    const fake = createFakeMailProvider();
    fake.deliver("ai/info", mail(1));
    expect(await fake.ensureFolder("AI/Info")).toBe("ai/info");
    // The user's parent `ai` is used for a new child.
    expect(await fake.ensureFolder("AI/New")).toBe("ai/New");
    expect(await fake.ensureFolder("Other/New")).toBe("Other/New");
    fake.deliver("AI/Exact", mail(2));
    fake.deliver("ai/exact", mail(3));
    expect(await fake.ensureFolder("AI/Exact")).toBe("AI/Exact");
    // The exact spelling wins also when the other spelling was delivered first.
    fake.deliver("ai/second", mail(4));
    fake.deliver("AI/Second", mail(5));
    expect(await fake.ensureFolder("AI/Second")).toBe("AI/Second");
    const dotted = createFakeMailProvider({ pathDelimiter: "." });
    expect(await dotted.ensureFolder("AI/Info")).toBe("AI.Info");
    expect(await dotted.ensureFolder("AI/Info")).toBe("AI.Info");
  });

  test("userMove back to INBOX with keepUidOnUserMove keeps the old uid and uidNext", async () => {
    const fake = createFakeMailProvider({ keepUidOnUserMove: true });
    const uid = fake.deliver(INBOX, mail(1));
    fake.deliver(INBOX, mail(2));
    const before = await fake.folderStatus(INBOX);
    expect(fake.userMove(INBOX, uid, "Archive")).toBe(uid);
    expect(fake.userMove("Archive", uid, INBOX)).toBe(uid);
    expect(await fake.folderStatus(INBOX)).toEqual(before);
  });

  test("deleteMessage without UIDPLUS throws HardError and keeps the message", async () => {
    const fake = createFakeMailProvider({ capabilities: { uidplus: false } });
    const uid = fake.deliver(INBOX, mail(1));
    await expect(fake.deleteMessage(INBOX, uid)).rejects.toBeInstanceOf(HardError);
    expect(await fake.fetchMetaIn(INBOX, uid)).not.toBeNull();
  });

  test("setFlags on a missing uid throws MailNotFoundError", async () => {
    const fake = createFakeMailProvider();
    await expect(fake.setFlags(INBOX, 5, { add: ["\\Seen"] })).rejects.toBeInstanceOf(MailNotFoundError);
  });

  test("failOn works for moveMessage and throws once", async () => {
    const fake = createFakeMailProvider();
    const uid = fake.deliver(INBOX, mail(1));
    await fake.ensureFolder("Target");
    fake.failOn("moveMessage", new SoftError("lost connection"));
    await expect(fake.moveMessage(INBOX, uid, "Target")).rejects.toBeInstanceOf(SoftError);
    expect((await fake.moveMessage(INBOX, uid, "Target")).newUid).toBe(1);
  });

  test("appendMessage stores the headers and the raw bytes", async () => {
    const fake = createFakeMailProvider();
    await fake.ensureFolder("Drafts");
    const raw = Buffer.from(
      [
        "Message-ID: <ea-1@example.test>",
        "From: Artek <me@example.test>",
        "To: Jan <jan@example.test>",
        "Subject: Fwd: Test",
        "Date: Sat, 07 Nov 2026 08:00:00 +0000",
        "In-Reply-To: <a@example.test>",
        "References: <a@example.test>",
        " <b@example.test>",
        "X-Ea-Action-ID: act-1",
        "",
        "Body",
      ].join("\r\n")
    );
    const date = new Date("2026-11-07T08:00:01Z");
    const { uid } = await fake.appendMessage("Drafts", raw, ["\\Draft"], date);
    const meta = await fake.fetchMetaIn("Drafts", uid ?? 0);
    expect(meta?.actionId).toBe("act-1");
    expect(meta?.messageId).toBe("<ea-1@example.test>");
    expect(meta?.from).toBe("me@example.test");
    expect(meta?.to).toEqual(["jan@example.test"]);
    expect(meta?.inReplyTo).toBe("<a@example.test>");
    expect(meta?.references).toEqual(["<a@example.test>", "<b@example.test>"]);
    expect(meta?.date).toEqual(new Date("2026-11-07T08:00:00Z"));
    expect(meta?.internalDate).toEqual(date);
    expect(meta?.size).toBe(raw.byteLength);
    expect(meta?.flags).toEqual(["\\Draft"]);
    expect(fake.calls).toContain("appendMessage");
  });

  test("appendMessage gives uid null without UIDPLUS and refuses a missing folder", async () => {
    const fake = createFakeMailProvider({ capabilities: { uidplus: false } });
    await fake.ensureFolder("Drafts");
    const raw = Buffer.from("Message-ID: <x@example.test>\r\n\r\nBody");
    expect(await fake.appendMessage("Drafts", raw, [], new Date())).toEqual({ uid: null });
    await expect(fake.appendMessage("Nope", raw, [], new Date())).rejects.toBeInstanceOf(HardError);
  });

  test("failOn(appendMessage) throws once", async () => {
    const fake = createFakeMailProvider();
    await fake.ensureFolder("Drafts");
    fake.failOn("appendMessage", new SoftError("boom"));
    const raw = Buffer.from("Message-ID: <x@example.test>\r\n\r\nBody");
    await expect(fake.appendMessage("Drafts", raw, [], new Date())).rejects.toBeInstanceOf(SoftError);
    expect((await fake.appendMessage("Drafts", raw, [], new Date())).uid).toBe(1);
  });

  describe("transferByAppend", () => {
    test("does not copy $Junk, Junk, \\Deleted and \\Recent; keeps the other flags", async () => {
      const fake = createFakeMailProvider();
      const uid = fake.deliver("Oferty", mail(1));
      await fake.setFlags("Oferty", uid, { add: ["\\Seen", "$Junk", "junk", "\\Deleted", "\\Recent", "$Label"] });
      const { newUid } = await fake.transferByAppend("Oferty", uid, INBOX);
      expect((await fake.fetchMetaIn(INBOX, newUid ?? 0))?.flags).toEqual(["$Label", "\\Seen"]);
      expect(await fake.fetchMetaIn("Oferty", uid)).toBeNull();
    });

    test("without UIDPLUS it throws HardError('no UIDPLUS') and writes nothing", async () => {
      const fake = createFakeMailProvider({ capabilities: { uidplus: false, move: false } });
      const uid = fake.deliver("Oferty", mail(1));
      await expect(fake.transferByAppend("Oferty", uid, INBOX)).rejects.toThrow("no UIDPLUS");
      expect(await fake.fetchAbove(INBOX, 0)).toEqual([]);
      expect(await fake.fetchMetaIn("Oferty", uid)).not.toBeNull();
    });

    test("failOn deleteMessage leaves the mail in both folders", async () => {
      const fake = createFakeMailProvider();
      const uid = fake.deliver("Oferty", mail(1));
      fake.failOn("deleteMessage", new HardError("x"));
      await expect(fake.transferByAppend("Oferty", uid, INBOX)).rejects.toBeInstanceOf(HardError);
      expect(await fake.fetchMetaIn("Oferty", uid)).not.toBeNull();
      expect(await fake.fetchAbove(INBOX, 0)).toHaveLength(1);
    });

    test("a message above 25 MB throws HardError('message too large to transfer') and writes nothing", async () => {
      const fake = createFakeMailProvider();
      const uid = fake.deliver("Oferty", mail(1), { size: 25_000_001 });
      await expect(fake.transferByAppend("Oferty", uid, INBOX)).rejects.toThrow("message too large to transfer");
      expect(await fake.fetchAbove(INBOX, 0)).toEqual([]);
      expect(await fake.fetchMetaIn("Oferty", uid)).not.toBeNull();
    });

    test("a missing target folder throws HardError before any write", async () => {
      const fake = createFakeMailProvider();
      const uid = fake.deliver("Oferty", mail(1));
      await expect(fake.transferByAppend("Oferty", uid, "Nope")).rejects.toThrow("TRYCREATE");
      expect(await fake.fetchMetaIn("Oferty", uid)).not.toBeNull();
      expect((await fake.listFolders()).map((f) => f.path)).not.toContain("Nope");
    });

    test("appendUid false: HardError('append gave no uid'), the source stays, the copy stays", async () => {
      const fake = createFakeMailProvider({ appendUid: false });
      const uid = fake.deliver("Oferty", mail(1));
      await expect(fake.transferByAppend("Oferty", uid, INBOX)).rejects.toThrow("append gave no uid");
      expect(await fake.fetchMetaIn("Oferty", uid)).not.toBeNull();
      expect(await fake.fetchAbove(INBOX, 0)).toHaveLength(1);
    });
  });
});
