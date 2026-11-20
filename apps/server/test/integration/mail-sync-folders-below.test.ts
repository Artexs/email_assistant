import { HOUR_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import {
  findUserMoves,
  refreshFlags,
  syncMailbox,
  type MailboxSyncResult,
  type MailProvider,
} from "../../src/modules/mail";
import type { DB } from "../../src/platform/db";

import { insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  type Setup,
  seed,
  spyFolderReads,
  copyRowsOf,
  withDebugLines,
  OFFERS,
  JUNK,
  FOLDER_NOW,
  ago,
  folderDeps,
  folderSetup,
  addFolderRow,
  folderRow,
  storedRows,
  of,
  withLogs,
} from "./mail-sync-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("syncMailbox: sync folders", () => {
  // A mail of source folder `path` (Mail 1) that the system moved to AI/Info an hour ago; `path` has a later mail
  // (Mail 2), so the cursor of `path` is above the UID of Mail 1.
  async function movedFromFolder(
    trx: Transaction<DB>,
    s: Setup,
    key: "offers" | "junk" | "inbox",
    path: string
  ): Promise<{ uid: number; rowId: string }> {
    if (key !== "inbox") await addFolderRow(trx, s, key, path, { lastUid: 0 });
    const uid = s.fake.deliver(path, seed(1), ago(2));
    await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
    s.fake.deliver(path, seed(2), ago(1));
    await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
    const row = await trx
      .selectFrom("emails")
      .select("id")
      .where("mailbox_id", "=", s.mailboxId)
      .where("subject", "=", "Mail 1")
      .executeTakeFirstOrThrow();
    return { uid, rowId: row.id };
  }

  async function markMoved(trx: Transaction<DB>, rowId: string, folder: string, movedAt: Date): Promise<void> {
    await trx.updateTable("emails").set({ folder, moved_at: movedAt }).where("id", "=", rowId).execute();
  }

  async function rowById(trx: Transaction<DB>, rowId: string) {
    const row = await trx
      .selectFrom("emails")
      .select(["uid", "source_uid", "folder", "source_folder", "returned_at"])
      .where("id", "=", rowId)
      .executeTakeFirstOrThrow();
    return { ...row, uid: Number(row.uid), source_uid: Number(row.source_uid) };
  }

  test("8.1 a mail that the user puts back into Oferty with the same UID below the cursor is returned", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const { uid, rowId } = await movedFromFolder(trx, s, "offers", OFFERS);
      // The system COPY gave the mail another UID in AI/Info than its UID in Oferty.
      const inFolder = s.fake.deliver("AI/Info", seed(1), ago(2));
      s.fake.remove(OFFERS, uid);
      expect(inFolder).not.toBe(uid);
      await trx.updateTable("emails").set({ uid: inFolder }).where("id", "=", rowId).execute();
      await trx
        .updateTable("mailbox_folders")
        .set({ last_uid: inFolder + 10 })
        .where("mailbox_id", "=", s.mailboxId)
        .where("key", "=", "offers")
        .execute();
      await markMoved(trx, rowId, "AI/Info", new Date(FOLDER_NOW.getTime() - HOUR_MS));
      expect(s.fake.userMove("AI/Info", inFolder, OFFERS)).toBe(inFolder);

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
        expect(of(result, "offers")?.returnedBelowCursor).toBe(1);
        expect(of(result, "inbox")?.returnedBelowCursor).toBe(0);
        expect(lines.info).toContain(
          `[mail] sync_below_cursor_done org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=offers checked=1 returned=1 copies=0`
        );
      });
      const row = await rowById(trx, rowId);
      expect(row).toMatchObject({ folder: OFFERS, source_folder: OFFERS, uid: inFolder, source_uid: inFolder });
      expect(row.returned_at).toEqual(FOLDER_NOW);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(2);
    });
  });

  test("8.1b a cursor of Oferty that moves during the check writes sync_below_cursor_moved with the key offers", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const { uid, rowId } = await movedFromFolder(trx, s, "offers", OFFERS);
      const inFolder = s.fake.deliver("AI/Info", seed(1), ago(2));
      s.fake.remove(OFFERS, uid);
      await trx.updateTable("emails").set({ uid: inFolder }).where("id", "=", rowId).execute();
      await trx
        .updateTable("mailbox_folders")
        .set({ last_uid: inFolder + 10 })
        .where("mailbox_id", "=", s.mailboxId)
        .where("key", "=", "offers")
        .execute();
      await markMoved(trx, rowId, "AI/Info", new Date(FOLDER_NOW.getTime() - HOUR_MS));
      s.fake.userMove("AI/Info", inFolder, OFFERS);
      const provider: MailProvider = {
        ...s.fake,
        fetchByUidsIn: async (folder, uids) => {
          const metas = await s.fake.fetchByUidsIn(folder, uids);
          if (folder === OFFERS) {
            await trx
              .updateTable("mailbox_folders")
              .set({ last_uid: inFolder + 99 })
              .where("mailbox_id", "=", s.mailboxId)
              .where("key", "=", "offers")
              .execute();
          }
          return metas;
        },
      };

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
        expect(of(result, "offers")?.returnedBelowCursor).toBe(0);
        expect(lines.warn).toContain(
          `[mail] sync_below_cursor_moved org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=offers`
        );
      });
    });
  });

  test("8.2 a mail still in AI/Info with an identical copy in Oferty at its UID is a copy, not a return", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const { uid, rowId } = await movedFromFolder(trx, s, "offers", OFFERS);
      const inFolder = s.fake.deliver("AI/Info", seed(1), ago(2));
      await markMoved(trx, rowId, "AI/Info", new Date(FOLDER_NOW.getTime() - HOUR_MS));
      await trx.updateTable("emails").set({ uid: inFolder }).where("id", "=", rowId).execute();

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "offers")?.copiesBelowCursor).toBe(1);
      expect(of(result, "offers")?.copiesStored).toBe(1);
      expect(of(result, "offers")?.returnedBelowCursor).toBe(0);
      const row = await rowById(trx, rowId);
      expect(row).toMatchObject({ folder: "AI/Info", uid: inFolder, source_uid: uid, returned_at: null });
      const moved = await trx
        .selectFrom("emails")
        .select("dedup_key")
        .where("id", "=", rowId)
        .executeTakeFirstOrThrow();
      const copies = await trx
        .selectFrom("emails")
        .select(["dedup_key", "status", "folder", "source_folder", "uid", "source_uid"])
        .where("mailbox_id", "=", s.mailboxId)
        .where("folder", "=", OFFERS)
        .where("subject", "=", "Mail 1")
        .execute();
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({
        dedup_key: `${moved.dedup_key}#2`,
        status: "pending",
        folder: OFFERS,
        source_folder: OFFERS,
      });
      expect([Number(copies[0]?.uid), Number(copies[0]?.source_uid)]).toEqual([uid, uid]);
    });
  });

  test("8.2b a user move back of the row's mail after its copy is stored is still a return", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const uid = s.fake.deliver("INBOX", seed(1), ago(2));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      await trx
        .updateTable("emails")
        .set({ folder: "AI/Info", moved_at: new Date(FOLDER_NOW.getTime() - HOUR_MS) })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      // The system COPY gave the mail its own UID in AI/Info; the INBOX original stays at its UID.
      const inFolder = s.fake.deliver("AI/Info", seed(1), ago(2));
      await trx.updateTable("emails").set({ uid: inFolder }).where("mailbox_id", "=", s.mailboxId).execute();
      // A newer INBOX mail moves the cursor past the folder UID.
      s.fake.deliver("INBOX", seed(2), ago(1));
      const first = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(first.copiesStored).toBe(1);
      expect(first.stored).toBe(2);
      const before = await copyRowsOf(trx, s.mailboxId);
      const copy = before.find((row) => row.dedup_key.endsWith("#2"));
      expect(copy).toMatchObject({ folder: "INBOX", uid, source_uid: uid });
      const moved = before.find((row) => row.folder === "AI/Info");

      expect(s.fake.userMove("AI/Info", inFolder, "INBOX")).toBe(inFolder);
      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(1);
      expect(result.copiesStored).toBe(0);
      const after = await copyRowsOf(trx, s.mailboxId);
      expect(after).toHaveLength(3);
      const returned = after.find((row) => row.id === moved?.id);
      expect(returned).toMatchObject({ folder: "INBOX", uid: inFolder });
      expect(returned?.returned_at?.getTime()).toBe(FOLDER_NOW.getTime());
      expect(after.find((row) => row.id === copy?.id)).toEqual(copy);
    });
  });

  test("8.3 a mail of source INBOX returned into INBOX below the cursor is returned by the INBOX run only", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      await s.fake.ensureFolder(OFFERS);
      const { uid, rowId } = await movedFromFolder(trx, s, "inbox", "INBOX");
      await markMoved(trx, rowId, "AI/Info", new Date(FOLDER_NOW.getTime() - HOUR_MS));
      s.fake.userMove("INBOX", uid, "AI/Info");
      s.fake.userMove("AI/Info", uid, "INBOX");

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "inbox")?.returnedBelowCursor).toBe(1);
      expect(of(result, "offers")?.returnedBelowCursor).toBe(0);
      const row = await rowById(trx, rowId);
      expect(row).toMatchObject({ folder: "INBOX", source_folder: "INBOX", uid, source_uid: uid });
      expect(row.returned_at).toEqual(FOLDER_NOW);
    });
  });

  test("8.4 a mail of source INBOX that the user files into Oferty below its cursor: the pass does not see it, the move finder after the flag refresh returns it", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      await s.fake.ensureFolder(OFFERS);
      const { uid, rowId } = await movedFromFolder(trx, s, "inbox", "INBOX");
      s.fake.deliver(OFFERS, seed(3), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect((await folderRow(trx, s.mailboxId, "offers"))?.lastUid).toBeGreaterThan(uid);
      await markMoved(trx, rowId, "AI/Info", new Date(FOLDER_NOW.getTime() - HOUR_MS));
      s.fake.userMove("INBOX", uid, "AI/Info");
      expect(s.fake.userMove("AI/Info", uid, OFFERS)).toBe(uid);
      const before = await storedRows(trx, s.mailboxId);

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "offers")?.returnedBelowCursor).toBe(0);
      expect(of(result, "inbox")?.returnedBelowCursor).toBe(0);
      expect(await storedRows(trx, s.mailboxId)).toEqual(before);
      const row = await rowById(trx, rowId);
      expect(row).toMatchObject({ folder: "AI/Info", source_folder: "INBOX", returned_at: null });

      const refreshed = await refreshFlags({ db: trx, provider: s.fake, now: () => FOLDER_NOW }, s.ctx, s.mailboxId);
      expect(refreshed.gone.map((target) => target.emailId)).toEqual([rowId]);
      const moves = await findUserMoves(
        { db: trx, provider: s.fake, now: () => FOLDER_NOW },
        s.ctx,
        s.mailboxId,
        refreshed.gone
      );
      expect(moves).toEqual({ checked: 1, returned: 1, relocated: 0, retry: 0 });
      const found = await rowById(trx, rowId);
      expect(found).toMatchObject({ folder: OFFERS, source_folder: OFFERS, uid, source_uid: uid });
      expect(found.returned_at).toEqual(FOLDER_NOW);
    });
  });

  test("8.6 a rescued mail that the user moves back into the spam folder with its UID is returned by the junk run", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const { uid, rowId } = await movedFromFolder(trx, s, "junk", JUNK);
      await markMoved(trx, rowId, "INBOX", new Date(FOLDER_NOW.getTime() - HOUR_MS));
      expect(s.fake.userMove(JUNK, uid, "INBOX")).toBe(uid);
      expect(s.fake.userMove("INBOX", uid, JUNK)).toBe(uid);

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "junk")?.returnedBelowCursor).toBe(1);
      expect(of(result, "inbox")?.returnedBelowCursor).toBe(0);
      const row = await rowById(trx, rowId);
      expect(row).toMatchObject({ folder: JUNK, source_folder: JUNK, uid, source_uid: uid });
      expect(row.returned_at).toEqual(FOLDER_NOW);
    });
  });

  test("8.7 the Oferty check fetches only Oferty by UID and reads only the row folder for the folder check", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const { uid, rowId } = await movedFromFolder(trx, s, "offers", OFFERS);
      await markMoved(trx, rowId, "AI/Info", new Date(FOLDER_NOW.getTime() - HOUR_MS));
      s.fake.userMove(OFFERS, uid, "AI/Info");
      s.fake.userMove("AI/Info", uid, OFFERS);
      const spy = spyFolderReads(s.fake);

      const result = await syncMailbox(folderDeps(trx, spy.provider), s.ctx, s.mailboxId);
      expect(of(result, "offers")?.returnedBelowCursor).toBe(1);
      const fetches = spy.folderCalls.filter((call) => call.method === "fetchByUidsIn");
      expect(fetches.length).toBeGreaterThan(0);
      expect(fetches.every((call) => call.folder === OFFERS)).toBe(true);
      const locates = spy.folderCalls.filter((call) => call.method !== "fetchByUidsIn");
      expect(locates.length).toBeGreaterThan(0);
      expect(locates.every((call) => call.folder === "AI/Info")).toBe(true);
      expect(spy.folderCalls.some((call) => call.folder === "INBOX")).toBe(false);
    });
  });

  // The Interia shape: Mail 1 came from `Oferty`, the system moved it to AI/Info (a copy at its folder UID), Oferty still holds it.
  async function copyOfMovedOffers(trx: Transaction<DB>, s: Setup) {
    const { uid, rowId } = await movedFromFolder(trx, s, "offers", OFFERS);
    const inFolder = s.fake.deliver("AI/Info", seed(1), ago(2));
    await markMoved(trx, rowId, "AI/Info", new Date(FOLDER_NOW.getTime() - HOUR_MS));
    await trx.updateTable("emails").set({ uid: inFolder }).where("id", "=", rowId).execute();
    const moved = await trx.selectFrom("emails").selectAll().where("id", "=", rowId).executeTakeFirstOrThrow();
    return { uid, rowId, moved };
  }

  test("3.2 another row of the identity that holds the hit UID holds the copy back", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const { uid, rowId, moved } = await copyOfMovedOffers(trx, s);
      // In another folder than Oferty: a row in Oferty at the hit UID is a known mail and is no hit at all.
      const heldId = await insertTestEmail(trx, s.ctx, s.mailboxId, {
        dedup_key: `${moved.dedup_key}#2`,
        message_id_header: moved.message_id_header,
        content_hash: moved.content_hash,
        folder: "AI/Spam",
        source_folder: "AI/Spam",
        uid,
        source_uid: uid,
      });
      const before = await trx.selectFrom("emails").selectAll().where("mailbox_id", "=", s.mailboxId).execute();

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(of(result as MailboxSyncResult, "offers")?.copiesBelowCursor).toBe(1);
      expect(of(result as MailboxSyncResult, "offers")?.copiesStored).toBe(0);
      const skipped = lines.filter((line) => line.includes("sync_below_cursor_copy_skipped"));
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain("kind=held");
      expect(skipped[0]).toContain(`email_id=${rowId}`);
      const after = await trx.selectFrom("emails").selectAll().where("mailbox_id", "=", s.mailboxId).execute();
      expect(after).toEqual(before);
      expect(after.find((row) => row.id === heldId)).toBeDefined();
    });
  });

  test("3.3 a cross copy stored by the INBOX pass holds the Oferty copy back; the next run stores it as #3", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      const { moved } = await copyOfMovedOffers(trx, s);
      // An identical mail above the INBOX cursor: the INBOX pass stores it as #2 before the Oferty check runs.
      s.fake.deliver("INBOX", seed(1), ago(2));

      const first = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(first, "inbox")?.stored).toBe(1);
      expect(of(first, "offers")?.copiesBelowCursor).toBe(1);
      expect(of(first, "offers")?.copiesStored).toBe(0);
      const keysOf = async () =>
        (await trx.selectFrom("emails").select("dedup_key").where("mailbox_id", "=", s.mailboxId).execute())
          .map((row) => row.dedup_key)
          .filter((key) => key.startsWith(moved.dedup_key))
          .sort();
      expect(await keysOf()).toEqual([moved.dedup_key, `${moved.dedup_key}#2`]);

      const second = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(second, "offers")?.copiesBelowCursor).toBe(1);
      expect(of(second, "offers")?.copiesStored).toBe(1);
      expect(await keysOf()).toEqual([moved.dedup_key, `${moved.dedup_key}#2`, `${moved.dedup_key}#3`]);
      const copy = await trx
        .selectFrom("emails")
        .select(["folder", "source_folder"])
        .where("dedup_key", "=", `${moved.dedup_key}#3`)
        .executeTakeFirstOrThrow();
      expect(copy).toEqual({ folder: OFFERS, source_folder: OFFERS });
    });
  });
});
