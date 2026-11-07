import { describe, expect, test } from "bun:test";

import { describeMailProviderContract } from "../../../../test/contract/mail-provider";
import { describeError, HardError, SoftError } from "../../../platform/errors";
import { INBOX, MailNotFoundError } from "../port";
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

describe("fake provider", () => {
  test("userMove gives a new uid in the target folder and removes the source", async () => {
    const fake = createFakeMailProvider();
    const uid = fake.deliver(INBOX, mail(1));
    const newUid = fake.userMove(INBOX, uid, "Archive");
    expect(newUid).toBe(1);
    expect(await fake.fetchByUids([uid])).toHaveLength(0);
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
    expect(await fake.inboxStatus()).toEqual({ uidValidity: 9, uidNext: 3 });
    const metas = await fake.fetchAbove(0);
    expect(metas.map((m) => [m.uid, m.messageId])).toEqual([
      [1, "<fake-1@example.test>"],
      [2, "<fake-3@example.test>"],
    ]);
  });

  test("failOn throws once, then the call works", async () => {
    const fake = createFakeMailProvider();
    fake.failOn("inboxStatus", new SoftError("lost connection"));
    await expect(fake.inboxStatus()).rejects.toBeInstanceOf(SoftError);
    expect((await fake.inboxStatus()).uidNext).toBe(1);
    expect(fake.calls).toEqual(["inboxStatus", "inboxStatus"]);
  });

  test("star quirk on returns the highest uid at or below the cursor; off returns nothing", async () => {
    const on = createFakeMailProvider();
    on.deliver(INBOX, mail(1));
    const top = on.deliver(INBOX, mail(2));
    expect((await on.fetchAbove(top)).map((m) => m.uid)).toEqual([top]);

    const off = createFakeMailProvider({ starQuirk: false });
    off.deliver(INBOX, mail(1));
    const offTop = off.deliver(INBOX, mail(2));
    expect(await off.fetchAbove(offTop)).toEqual([]);
  });

  test("close sets closed", async () => {
    const fake = createFakeMailProvider();
    await fake.close();
    expect(fake.closed).toBe(true);
  });

  test("fetchBodyText gives null when the size is over bodyLimitBytes", async () => {
    const fake = createFakeMailProvider({ bodyLimitBytes: 10 });
    const uid = fake.deliver(INBOX, mail(1), { size: 11 });
    expect(await fake.fetchBodyText(uid)).toBeNull();
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

  test("userMove back to INBOX with keepUidOnCopy keeps the old uid and uidNext", async () => {
    const fake = createFakeMailProvider({ keepUidOnCopy: true });
    const uid = fake.deliver(INBOX, mail(1));
    fake.deliver(INBOX, mail(2));
    const before = await fake.inboxStatus();
    expect(fake.userMove(INBOX, uid, "Archive")).toBe(uid);
    expect(fake.userMove("Archive", uid, INBOX)).toBe(uid);
    expect(await fake.inboxStatus()).toEqual(before);
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
});
