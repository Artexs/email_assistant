import { afterAll, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { findUserMoves, type MailProvider, type SeedMessage } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import type { FlagTarget } from "../../src/modules/mail/repo";
import { contentHash } from "../../src/modules/mail/sync-rules";
import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-08T12:00:00Z");
const HOUR = 3_600_000;
const OFFERS = "Oferty";
const JUNK = "Wiadomości-śmieci";

interface Box {
  orgId: string;
  mailboxId: string;
}

type Trx = Transaction<DB>;

// The Interia shape: one UID counter, no MOVE, a user move keeps the UID.
function interiaFake(): FakeMailProvider {
  return createFakeMailProvider({
    uidValidity: 7,
    globalUids: true,
    keepUidOnUserMove: true,
    uidNextValue: 1,
    capabilities: { move: false },
  });
}

function seed(n: number): SeedMessage {
  return {
    messageId: `<m${n}@x.test>`,
    from: `sender${n}@x.test`,
    to: ["box@x.test"],
    subject: `Mail ${n}`,
    date: new Date(NOW.getTime() - HOUR),
    text: `Body ${n}`,
  };
}

const ago = (hours: number): Date => new Date(NOW.getTime() - hours * HOUR);
const deliverOpts = { internalDate: ago(1) };

async function setInboxCursor(trx: Trx, box: Box, lastUid: number): Promise<void> {
  await trx
    .updateTable("mailbox_folders")
    .set({ uidvalidity: 7, last_uid: lastUid })
    .where("mailbox_id", "=", box.mailboxId)
    .where("key", "=", "inbox")
    .execute();
}

async function addFolderRow(
  trx: Trx,
  box: Box,
  key: "offers" | "junk",
  path: string,
  opts: { enabled?: boolean; lastUid: number | null }
): Promise<void> {
  await trx
    .insertInto("mailbox_folders")
    .values({
      org_id: box.orgId,
      mailbox_id: box.mailboxId,
      key,
      path,
      role: key === "junk" ? "junk" : "sort",
      enabled: opts.enabled ?? true,
      uidvalidity: 7,
      last_uid: opts.lastUid,
    })
    .execute();
}

async function setFolderCursor(trx: Trx, box: Box, key: string, lastUid: number): Promise<void> {
  await trx
    .updateTable("mailbox_folders")
    .set({ last_uid: lastUid })
    .where("mailbox_id", "=", box.mailboxId)
    .where("key", "=", key)
    .execute();
}

async function newBox(trx: Trx): Promise<Box> {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  return { orgId, mailboxId };
}

// A stored row for the mail that the fake holds at `folder`/`uid`, with the identity of that mail.
async function stored(
  trx: Trx,
  box: Box,
  fake: FakeMailProvider,
  folder: string,
  uid: number,
  row: { folder: string; source_folder: string; moved_at?: Date; undo_pending_at?: Date }
): Promise<string> {
  const meta = await fake.fetchMetaIn(folder, uid);
  if (meta === null) throw new Error("the fake holds no such mail");
  return insertTestEmail(trx, { orgId: box.orgId }, box.mailboxId, {
    uid,
    inbox_uid: uid,
    folder: row.folder,
    source_folder: row.source_folder,
    moved_at: row.moved_at ?? null,
    undo_pending_at: row.undo_pending_at ?? null,
    message_id_header: meta.messageId,
    content_hash: contentHash(meta),
    from_address: meta.from,
    received_at: meta.internalDate,
  });
}

async function targetOf(
  fake: FakeMailProvider,
  id: string,
  folder: string,
  uid: number,
  at: string
): Promise<FlagTarget> {
  const meta = await fake.fetchMetaIn(at, uid);
  if (meta === null) throw new Error("the fake holds no such mail");
  return { emailId: id, folder, uid, messageId: meta.messageId, receivedAt: meta.internalDate };
}

async function rowOf(trx: Trx, id: string) {
  const row = await trx
    .selectFrom("emails")
    .select(["folder", "source_folder", "uid", "inbox_uid", "returned_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  return { ...row, uid: Number(row.uid), inbox_uid: Number(row.inbox_uid) };
}

const depsOf = (trx: Trx, provider: MailProvider, chunkSize?: number) => ({
  db: trx,
  provider,
  now: () => NOW,
  ...(chunkSize === undefined ? {} : { chunkSize }),
});

interface Interia {
  box: Box;
  fake: FakeMailProvider;
  id: string;
  uid: number;
  target: FlagTarget;
}

// Mail 1 was delivered into INBOX and stored there; the user then moved it into Oferty (the UID stays).
async function movedIntoOffers(
  trx: Trx,
  opts: { offersLastUid?: (uid: number) => number | null; offersEnabled?: boolean; undoPendingAt?: Date } = {}
): Promise<Interia> {
  const box = await newBox(trx);
  const fake = interiaFake();
  const uid = fake.deliver("INBOX", seed(1), deliverOpts);
  const id = await stored(trx, box, fake, "INBOX", uid, {
    folder: "INBOX",
    source_folder: "INBOX",
    ...(opts.undoPendingAt === undefined ? {} : { undo_pending_at: opts.undoPendingAt }),
  });
  const target = await targetOf(fake, id, "INBOX", uid, "INBOX");
  expect(fake.userMove("INBOX", uid, OFFERS)).toBe(uid);
  await setInboxCursor(trx, box, uid + 5);
  const offersLastUid = opts.offersLastUid === undefined ? uid + 5 : opts.offersLastUid(uid);
  await addFolderRow(trx, box, "offers", OFFERS, { lastUid: offersLastUid, enabled: opts.offersEnabled ?? true });
  return { box, fake, id, uid, target };
}

async function withLogs(fn: (lines: () => string[]) => Promise<void>): Promise<void> {
  const out = spyOn(console, "log").mockImplementation(() => undefined);
  const err = spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await fn(() => [...out.mock.calls, ...err.mock.calls].map((call) => call.join(" ")));
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

describe("findUserMoves", () => {
  test("3.1 a mail that the user files from INBOX into Oferty below its cursor is relocated", async () => {
    await withRollback(db, async (trx) => {
      const s = await movedIntoOffers(trx);
      const result = await findUserMoves(depsOf(trx, s.fake), { orgId: s.box.orgId }, s.box.mailboxId, [s.target]);
      expect(result).toEqual({ checked: 1, returned: 0, relocated: 1, retry: 0 });
      expect(await rowOf(trx, s.id)).toEqual({
        folder: OFFERS,
        source_folder: OFFERS,
        uid: s.uid,
        inbox_uid: s.uid,
        returned_at: null,
      });
    });
  });

  test("3.2 a spam-folder mail that the user moves into INBOX below its cursor is relocated", async () => {
    await withRollback(db, async (trx) => {
      const box = await newBox(trx);
      const fake = interiaFake();
      const uid = fake.deliver(JUNK, seed(1), deliverOpts);
      const id = await stored(trx, box, fake, JUNK, uid, { folder: JUNK, source_folder: JUNK });
      const target = await targetOf(fake, id, JUNK, uid, JUNK);
      expect(fake.userMove(JUNK, uid, "INBOX")).toBe(uid);
      await setInboxCursor(trx, box, uid + 5);
      await addFolderRow(trx, box, "junk", JUNK, { lastUid: uid + 5 });

      const result = await findUserMoves(depsOf(trx, fake), { orgId: box.orgId }, box.mailboxId, [target]);
      expect(result).toEqual({ checked: 1, returned: 0, relocated: 1, retry: 0 });
      expect(await rowOf(trx, id)).toMatchObject({ folder: "INBOX", source_folder: "INBOX", uid, inbox_uid: uid });
    });
  });

  test("3.3 a system-moved mail that the user files into another synced folder below its cursor is returned", async () => {
    await withRollback(db, async (trx) => {
      const box = await newBox(trx);
      const fake = interiaFake();
      const uid = fake.deliver("AI/Info", seed(1), deliverOpts);
      const id = await stored(trx, box, fake, "AI/Info", uid, {
        folder: "AI/Info",
        source_folder: "INBOX",
        moved_at: ago(1),
      });
      const target = await targetOf(fake, id, "AI/Info", uid, "AI/Info");
      expect(fake.userMove("AI/Info", uid, OFFERS)).toBe(uid);
      await setInboxCursor(trx, box, uid + 5);
      await addFolderRow(trx, box, "offers", OFFERS, { lastUid: uid + 5 });

      const result = await findUserMoves(depsOf(trx, fake), { orgId: box.orgId }, box.mailboxId, [target]);
      expect(result).toEqual({ checked: 1, returned: 1, relocated: 0, retry: 0 });
      const row = await rowOf(trx, id);
      expect(row).toMatchObject({ folder: OFFERS, source_folder: OFFERS, uid, inbox_uid: uid });
      expect(row.returned_at).toEqual(NOW);
    });
  });

  test("3.4 a return into the own source after the 7-day window is returned, and the hit ends the search", async () => {
    await withRollback(db, async (trx) => {
      const box = await newBox(trx);
      const fake = interiaFake();
      const uid = fake.deliver("AI/Info", seed(1), deliverOpts);
      const id = await stored(trx, box, fake, "AI/Info", uid, {
        folder: "AI/Info",
        source_folder: "INBOX",
        moved_at: ago(8 * 24),
      });
      const target = await targetOf(fake, id, "AI/Info", uid, "AI/Info");
      expect(fake.userMove("AI/Info", uid, "INBOX")).toBe(uid);
      await setInboxCursor(trx, box, uid + 5);
      await addFolderRow(trx, box, "offers", OFFERS, { lastUid: uid + 5 });
      const before = fake.folderCalls.length;

      const result = await findUserMoves(depsOf(trx, fake), { orgId: box.orgId }, box.mailboxId, [target]);
      expect(result).toEqual({ checked: 1, returned: 1, relocated: 0, retry: 0 });
      const row = await rowOf(trx, id);
      expect(row).toMatchObject({ folder: "INBOX", source_folder: "INBOX", uid });
      expect(row.returned_at).toEqual(NOW);
      expect(fake.folderCalls.slice(before)).toEqual([{ method: "fetchByUidsIn", folder: "INBOX" }]);
    });
  });

  test("3.5 a row that moved after the refresh read it is not checked", async () => {
    await withRollback(db, async (trx) => {
      const box = await newBox(trx);
      const fake = interiaFake();
      const uid = fake.deliver("AI/Info", seed(1), deliverOpts);
      const id = await stored(trx, box, fake, "AI/Info", uid, {
        folder: "AI/Info",
        source_folder: "INBOX",
        moved_at: ago(1),
      });
      // The refresh read the row in INBOX; the DB row is in AI/Info now.
      const target = { ...(await targetOf(fake, id, "AI/Info", uid, "AI/Info")), folder: "INBOX" };
      await setInboxCursor(trx, box, uid + 5);
      await addFolderRow(trx, box, "offers", OFFERS, { lastUid: uid + 5 });
      const before = fake.folderCalls.length;

      const result = await findUserMoves(depsOf(trx, fake), { orgId: box.orgId }, box.mailboxId, [target]);
      expect(result).toEqual({ checked: 0, returned: 0, relocated: 0, retry: 0 });
      expect(fake.folderCalls.length).toBe(before);
      expect(await rowOf(trx, id)).toMatchObject({ folder: "AI/Info", source_folder: "INBOX", returned_at: null });
    });
  });

  test("3.6 a fresh move marker skips the row; an old marker does not", async () => {
    await withRollback(db, async (trx) => {
      const s = await movedIntoOffers(trx, { undoPendingAt: ago(1) });
      const deps = depsOf(trx, s.fake);
      const ctx = { orgId: s.box.orgId };

      const fresh = await findUserMoves(deps, ctx, s.box.mailboxId, [s.target]);
      expect(fresh).toEqual({ checked: 0, returned: 0, relocated: 0, retry: 0 });
      expect(await rowOf(trx, s.id)).toMatchObject({ folder: "INBOX", source_folder: "INBOX" });

      await trx
        .updateTable("emails")
        .set({ undo_pending_at: ago(25) })
        .where("id", "=", s.id)
        .execute();
      const old = await findUserMoves(deps, ctx, s.box.mailboxId, [s.target]);
      expect(old).toEqual({ checked: 1, returned: 0, relocated: 1, retry: 0 });
    });
  });

  test("3.7 a UID above the cursor of the folder is not fetched there", async () => {
    await withRollback(db, async (trx) => {
      const s = await movedIntoOffers(trx, { offersLastUid: (uid) => uid - 1 });
      const before = s.fake.folderCalls.length;

      const result = await findUserMoves(depsOf(trx, s.fake), { orgId: s.box.orgId }, s.box.mailboxId, [s.target]);
      expect(result).toEqual({ checked: 1, returned: 0, relocated: 0, retry: 0 });
      expect(s.fake.folderCalls.slice(before).filter((call) => call.folder === OFFERS)).toEqual([]);
      expect(await rowOf(trx, s.id)).toMatchObject({ folder: "INBOX", source_folder: "INBOX" });
    });
  });

  test("3.8 an identical row that holds the UID in the folder blocks the write", async () => {
    await withRollback(db, async (trx) => {
      const s = await movedIntoOffers(trx);
      const other = await stored(trx, s.box, s.fake, OFFERS, s.uid, { folder: OFFERS, source_folder: OFFERS });

      const result = await findUserMoves(depsOf(trx, s.fake), { orgId: s.box.orgId }, s.box.mailboxId, [s.target]);
      expect(result).toEqual({ checked: 1, returned: 0, relocated: 0, retry: 0 });
      expect(await rowOf(trx, s.id)).toMatchObject({ folder: "INBOX", source_folder: "INBOX" });
      expect(await rowOf(trx, other)).toMatchObject({ folder: OFFERS, source_folder: OFFERS });
    });
  });

  test("3.9 a cursor that moves during the check gives a retry; the next call writes", async () => {
    await withRollback(db, async (trx) => {
      const s = await movedIntoOffers(trx);
      const ctx = { orgId: s.box.orgId };
      const racing: MailProvider = {
        ...s.fake,
        fetchByUidsIn: async (folder, uids) => {
          if (folder === OFFERS) await setFolderCursor(trx, s.box, "offers", s.uid + 6);
          return s.fake.fetchByUidsIn(folder, uids);
        },
      };

      await withLogs(async (lines) => {
        const result = await findUserMoves(depsOf(trx, racing), ctx, s.box.mailboxId, [s.target]);
        expect(result).toEqual({ checked: 1, returned: 0, relocated: 0, retry: 1 });
        expect(lines().filter((line) => line.includes("user_moves_retry"))).toHaveLength(1);
      });
      expect(await rowOf(trx, s.id)).toMatchObject({ folder: "INBOX", source_folder: "INBOX" });

      const again = await findUserMoves(depsOf(trx, s.fake), ctx, s.box.mailboxId, [s.target]);
      expect(again.relocated).toBe(1);
    });
  });

  test("3.10 nothing gone: no query result, no provider call, no log line", async () => {
    await withRollback(db, async (trx) => {
      const s = await movedIntoOffers(trx);
      const before = s.fake.folderCalls.length;

      await withLogs(async (lines) => {
        const result = await findUserMoves(depsOf(trx, s.fake), { orgId: s.box.orgId }, s.box.mailboxId, []);
        expect(result).toEqual({ checked: 0, returned: 0, relocated: 0, retry: 0 });
        expect(lines().filter((line) => line.includes("user_moves"))).toEqual([]);
      });
      expect(s.fake.folderCalls.length).toBe(before);
    });
  });

  test("3.11 gone mail is fetched in chunks, one fetch per chunk and folder, and nothing else", async () => {
    await withRollback(db, async (trx) => {
      const box = await newBox(trx);
      const fake = interiaFake();
      const targets: FlagTarget[] = [];
      const uids: number[] = [];
      for (const n of [1, 2, 3]) {
        const uid = fake.deliver("AI/Info", seed(n), deliverOpts);
        const id = await stored(trx, box, fake, "AI/Info", uid, {
          folder: "AI/Info",
          source_folder: "INBOX",
          moved_at: ago(1),
        });
        targets.push(await targetOf(fake, id, "AI/Info", uid, "AI/Info"));
        uids.push(uid);
      }
      for (const uid of uids) fake.remove("AI/Info", uid);
      const top = Math.max(...uids) + 5;
      await setInboxCursor(trx, box, top);
      await addFolderRow(trx, box, "offers", OFFERS, { lastUid: top });
      // The setup read the mail with `fetchMetaIn`: count the calls from here.
      const before = fake.folderCalls.length;

      const result = await findUserMoves(depsOf(trx, fake, 2), { orgId: box.orgId }, box.mailboxId, targets);
      expect(result).toEqual({ checked: 3, returned: 0, relocated: 0, retry: 0 });
      expect(fake.folderCalls.slice(before)).toEqual([
        { method: "fetchByUidsIn", folder: "INBOX" },
        { method: "fetchByUidsIn", folder: "INBOX" },
        { method: "fetchByUidsIn", folder: OFFERS },
        { method: "fetchByUidsIn", folder: OFFERS },
      ]);
    });
  });

  describe("3.12 skipped folders", () => {
    test("a folder in skipFolders", async () => {
      await withRollback(db, async (trx) => {
        const s = await movedIntoOffers(trx);
        const before = s.fake.folderCalls.length;
        const result = await findUserMoves(depsOf(trx, s.fake), { orgId: s.box.orgId }, s.box.mailboxId, [s.target], {
          skipFolders: ["offers"],
        });
        expect(result.relocated).toBe(0);
        expect(s.fake.folderCalls.slice(before).filter((call) => call.folder === OFFERS)).toEqual([]);
      });
    });

    test("a disabled folder", async () => {
      await withRollback(db, async (trx) => {
        const s = await movedIntoOffers(trx, { offersEnabled: false });
        const before = s.fake.folderCalls.length;
        const result = await findUserMoves(depsOf(trx, s.fake), { orgId: s.box.orgId }, s.box.mailboxId, [s.target]);
        expect(result.relocated).toBe(0);
        expect(s.fake.folderCalls.slice(before).filter((call) => call.folder === OFFERS)).toEqual([]);
      });
    });

    test("a folder without a cursor", async () => {
      await withRollback(db, async (trx) => {
        const s = await movedIntoOffers(trx, { offersLastUid: () => null });
        const before = s.fake.folderCalls.length;
        const result = await findUserMoves(depsOf(trx, s.fake), { orgId: s.box.orgId }, s.box.mailboxId, [s.target]);
        expect(result.relocated).toBe(0);
        expect(s.fake.folderCalls.slice(before).filter((call) => call.folder === OFFERS)).toEqual([]);
      });
    });
  });

  test("3.13 a row of another organization is not checked and not changed", async () => {
    await withRollback(db, async (trx) => {
      const s = await movedIntoOffers(trx);
      const other = await newBox(trx);
      const otherId = await stored(trx, other, s.fake, OFFERS, s.uid, { folder: "INBOX", source_folder: "INBOX" });
      const foreign = await targetOf(s.fake, otherId, "INBOX", s.uid, OFFERS);

      const result = await findUserMoves(depsOf(trx, s.fake), { orgId: s.box.orgId }, s.box.mailboxId, [foreign]);
      expect(result).toEqual({ checked: 0, returned: 0, relocated: 0, retry: 0 });
      expect(await rowOf(trx, otherId)).toMatchObject({ folder: "INBOX", source_folder: "INBOX" });
    });
  });

  test("3.14 the log lines hold counts and no path, Message-ID or address", async () => {
    await withRollback(db, async (trx) => {
      const s = await movedIntoOffers(trx);
      await withLogs(async (lines) => {
        await findUserMoves(depsOf(trx, s.fake), { orgId: s.box.orgId }, s.box.mailboxId, [s.target]);
        const all = lines();
        const checked = all.filter((line) => line.includes("user_moves_checked"));
        expect(checked).toHaveLength(1);
        expect(checked[0]).toContain("count=1");
        expect(all.filter((line) => line.includes("user_moves_found"))).toHaveLength(1);
        for (const secret of [OFFERS, "<m1@x.test>", "sender1@x.test"]) {
          expect(all.filter((line) => line.includes(secret))).toEqual([]);
        }
      });
    });
  });
});
