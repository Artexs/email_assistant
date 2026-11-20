import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { syncMailbox, type MailboxSyncResult, type MailProvider } from "../../src/modules/mail";
import { forceRescan } from "../../src/modules/mail/repo";
import type { DB, Db } from "../../src/platform/db";
import { HardError, SoftError } from "../../src/platform/errors";

import { testDb, withRollback } from "./helpers";
import {
  type Setup,
  seed,
  emails,
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
  // Cross-folder dedup.
  async function crossRows(trx: Db | Transaction<DB>, mailboxId: string) {
    const rows = await trx
      .selectFrom("emails")
      .select(["dedup_key", "uid", "source_uid", "folder", "source_folder", "returned_at", "moved_at"])
      .where("mailbox_id", "=", mailboxId)
      .orderBy("uid")
      .execute();
    return rows.map((row) => ({
      ...row,
      uid: Number(row.uid),
      source_uid: row.source_uid === null ? null : Number(row.source_uid),
    }));
  }

  // The system moved the stored row (one row in the mailbox) to `AI/Info`, and so did the server.
  async function markSystemMoved(trx: Db | Transaction<DB>, s: Setup, from: string, uid: number): Promise<number> {
    await trx
      .updateTable("emails")
      .set({ folder: "AI/Info", moved_at: FOLDER_NOW })
      .where("mailbox_id", "=", s.mailboxId)
      .execute();
    return s.fake.userMove(from, uid, "AI/Info");
  }

  test("7b.1 a row in INBOX and the same mail delivered into Oferty: Oferty stores nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver("INBOX", seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      s.fake.deliver(OFFERS, seed(1), ago(1));

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(result?.failed).toEqual([]);
      expect(of(result as MailboxSyncResult, "offers")?.stored).toBe(0);
      expect(of(result as MailboxSyncResult, "offers")?.crossCopies).toBe(1);
      const rows = await crossRows(trx, s.mailboxId);
      expect(rows.map((row) => row.folder)).toEqual(["INBOX"]);
      const [row] = await trx.selectFrom("emails").select("id").where("mailbox_id", "=", s.mailboxId).execute();
      expect(lines.filter((line) => line.includes("sync_cross_copy"))).toEqual([
        `[mail] sync_cross_copy org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=offers email_id=${row?.id}`,
      ]);
    });
  });

  test("7b.2 the same mail new in INBOX and in Oferty in one run: INBOX stores it, Oferty counts a cross copy with no locate", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver("INBOX", seed(1), ago(1));
      s.fake.deliver(OFFERS, seed(1), ago(1));
      const callsBefore = s.fake.folderCalls.length;

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.failed).toEqual([]);
      expect(of(result, "inbox")?.stored).toBe(1);
      expect(of(result, "offers")?.stored).toBe(0);
      expect(of(result, "offers")?.crossCopies).toBe(1);
      const rows = await crossRows(trx, s.mailboxId);
      expect(rows.map((row) => row.folder)).toEqual(["INBOX"]);
      const methods = s.fake.folderCalls.slice(callsBefore).map((call) => call.method);
      expect(methods).not.toContain("fetchMetaIn");
      expect(methods).not.toContain("searchSinceIn");
    });
  });

  test("7b.3 a rescan of INBOX and Oferty with the anna case: INBOX update_uid, Oferty cross copy, no new row", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver("INBOX", seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      s.fake.deliver(OFFERS, seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(await forceRescan(trx, s.ctx, s.mailboxId)).toBe(true);

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "inbox")?.mode).toBe("rescan");
      expect(of(result, "inbox")?.uidUpdated).toBe(1);
      expect(of(result, "offers")?.mode).toBe("rescan");
      expect(of(result, "offers")?.crossCopies).toBe(1);
      expect(of(result, "offers")?.uidUpdated).toBe(0);
      expect(await crossRows(trx, s.mailboxId)).toHaveLength(1);
    });
  });

  test("7b.4 a user move from INBOX into Oferty is relocated: no new row, no feedback", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { keepUidOnUserMove: false });
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      await s.fake.ensureFolder(OFFERS);
      const uid = s.fake.deliver("INBOX", seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      const moved = s.fake.userMove("INBOX", uid, OFFERS);

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "offers")?.relocated).toBe(1);
      expect(of(result, "offers")?.stored).toBe(0);
      const rows = await crossRows(trx, s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        folder: OFFERS,
        source_folder: OFFERS,
        uid: moved,
        source_uid: moved,
        returned_at: null,
      });
      const feedback = await trx.selectFrom("triage_feedback").select("id").where("org_id", "=", s.ctx.orgId).execute();
      expect(feedback).toHaveLength(0);
    });
  });

  test("7b.5 a mail moved back into its source Oferty above the cursor is returned", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { keepUidOnUserMove: false });
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      const uid = s.fake.deliver(OFFERS, seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      const inInfo = await markSystemMoved(trx, s, OFFERS, uid);
      const back = s.fake.userMove("AI/Info", inInfo, OFFERS);

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "offers")?.returned).toBe(1);
      const rows = await crossRows(trx, s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        folder: OFFERS,
        source_folder: OFFERS,
        uid: back,
        source_uid: back,
        returned_at: FOLDER_NOW,
      });
    });
  });

  test("7b.6 a returned mail in INBOX that is also in Oferty: INBOX returned, Oferty cross copy, no new row", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { keepUidOnUserMove: false });
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      const uid = s.fake.deliver("INBOX", seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      const inInfo = await markSystemMoved(trx, s, "INBOX", uid);
      const back = s.fake.userMove("AI/Info", inInfo, "INBOX");
      s.fake.deliver(OFFERS, seed(1), ago(1));

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "inbox")?.returned).toBe(1);
      expect(of(result, "offers")?.crossCopies).toBe(1);
      expect(of(result, "offers")?.stored).toBe(0);
      const rows = await crossRows(trx, s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ folder: "INBOX", source_folder: "INBOX", uid: back, returned_at: FOLDER_NOW });
    });
  });

  test("7b.7 a mail of source INBOX that the user files into Oferty counts as a return", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx, { keepUidOnUserMove: false });
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      await s.fake.ensureFolder(OFFERS);
      const uid = s.fake.deliver("INBOX", seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      const inInfo = await markSystemMoved(trx, s, "INBOX", uid);
      const filed = s.fake.userMove("AI/Info", inInfo, OFFERS);

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "offers")?.returned).toBe(1);
      const rows = await crossRows(trx, s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        folder: OFFERS,
        source_folder: OFFERS,
        uid: filed,
        source_uid: filed,
        returned_at: FOLDER_NOW,
      });
    });
  });

  test("7b.8 a move in flight: its copies in INBOX and Oferty are not stored and not located", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      const uid = s.fake.deliver("INBOX", seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      await markSystemMoved(trx, s, "INBOX", uid);
      await trx
        .updateTable("emails")
        .set({ move_pending_at: new Date(FOLDER_NOW.getTime() - MINUTE_MS) })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      s.fake.deliver("INBOX", seed(1), ago(1));
      s.fake.deliver(OFFERS, seed(1), ago(1));
      const callsBefore = s.fake.folderCalls.length;

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(of(result as MailboxSyncResult, "inbox")?.moveInFlight).toBe(1);
      expect(of(result as MailboxSyncResult, "offers")?.moveInFlight).toBe(1);
      const [row] = await trx.selectFrom("emails").select("id").where("mailbox_id", "=", s.mailboxId).execute();
      const target = `[mail] sync_move_target_copy org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} email_id=${row?.id}`;
      expect(lines.filter((line) => line.includes("sync_move_target_copy"))).toEqual([target, target]);
      expect(await crossRows(trx, s.mailboxId)).toHaveLength(1);
      const methods = s.fake.folderCalls.slice(callsBefore).map((call) => call.method);
      expect(methods).not.toContain("fetchMetaIn");
      expect(methods).not.toContain("searchSinceIn");
    });
  });

  test("7b.10 a rescan of INBOX and Oferty: the INBOX copy is a cross copy, the Oferty pass updates the row's UID", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver(OFFERS, seed(1), ago(1));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      s.fake.deliver("INBOX", seed(1), ago(1));
      expect(await forceRescan(trx, s.ctx, s.mailboxId)).toBe(true);
      s.fake.resetUidValidity(9, OFFERS);

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "inbox")?.crossCopies).toBe(1);
      expect(of(result, "offers")?.crossCopies).toBe(0);
      expect(of(result, "offers")?.uidUpdated).toBe(1);
      const rows = await crossRows(trx, s.mailboxId);
      const [offersUid] = (await s.fake.fetchAbove(OFFERS, 0)).map((meta) => meta.uid);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ folder: OFFERS, source_folder: OFFERS, uid: offersUid, source_uid: offersUid });
    });
  });

  test("7b.12 a chunk that fails before its commit leaves no run state: the later folder stores the mail", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      await addFolderRow(trx, s, "junk", JUNK, { lastUid: 0 });
      s.fake.deliver(OFFERS, seed(1), ago(1));
      const failing = s.fake.deliver(OFFERS, seed(2), ago(1));
      s.fake.deliver(JUNK, seed(1), ago(1));
      const provider: MailProvider = {
        ...s.fake,
        fetchContent: async (folder, uid) => {
          if (folder === OFFERS && uid === failing) throw new SoftError("lost connection");
          return s.fake.fetchContent(folder, uid);
        },
      };

      await withLogs(async () => {
        const result = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
        expect(result.failed).toEqual(["offers"]);
        expect(of(result, "junk")?.stored).toBe(1);
        expect(of(result, "junk")?.crossCopies).toBe(0);
      });
      const rows = await crossRows(trx, s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ folder: JUNK, source_folder: JUNK });
    });
  });

  for (const chunkSize of [undefined, 1]) {
    test(`7b.9 two identical new copies in Oferty: the second row gets #2 (chunkSize ${chunkSize ?? "default"})`, async () => {
      await withRollback(db, async (trx) => {
        const s = await folderSetup(trx);
        await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
        s.fake.deliver(OFFERS, seed(1), ago(1));
        s.fake.deliver(OFFERS, seed(1), ago(1));

        const overrides = chunkSize === undefined ? {} : { chunkSize };
        const result = await syncMailbox(folderDeps(trx, s.fake, overrides), s.ctx, s.mailboxId);
        expect(of(result, "offers")?.stored).toBe(2);
        const rows = (await emails(trx, s.mailboxId)).filter((row) => row.folder === OFFERS);
        expect(rows).toHaveLength(2);
        expect(rows[1]?.dedup_key).toBe(`${rows[0]?.dedup_key}#2`);
      });
    });
  }

  test("12. a folder that is the trash path in folder_map is not added", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await trx
        .updateTable("mailboxes")
        .set({ folder_map: JSON.stringify({ drafts: "Drafts", trash: OFFERS }) })
        .where("id", "=", s.mailboxId)
        .execute();
      s.fake.deliver(OFFERS, seed(1), ago(1));

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.added).toEqual([]);
      expect(await folderRow(trx, s.mailboxId, "offers")).toBeUndefined();
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(0);
    });
  });

  test("13. a failed discovery gives one warn line and the existing rows sync", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver("INBOX", seed(1), ago(1));
      s.fake.deliver(OFFERS, seed(2), ago(1));
      s.fake.failOn("listFolders", new HardError("list failed for MARKER-ADDR@x.test"));

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
        expect(result.stored).toBe(1);
        expect(of(result, "offers")?.stored).toBe(1);
        expect(result.added).toEqual([]);
        expect(lines.warn).toEqual([
          `[mail] sync_folder_discovery_failed org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} error=HardError`,
        ]);
        expect(lines.info.join("\n")).not.toContain("MARKER");
      });
    });
  });

  test("16. a failed discovery and no INBOX row: HardError and last_synced_at stays empty", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await trx.deleteFrom("mailbox_folders").where("mailbox_id", "=", s.mailboxId).execute();
      s.fake.failOn("listFolders", new SoftError("lost connection"));

      const error = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(HardError);
      expect((error as Error).message).toBe("mailbox has no INBOX folder row");
      const mailbox = await trx
        .selectFrom("mailboxes")
        .select("last_synced_at")
        .where("id", "=", s.mailboxId)
        .executeTakeFirstOrThrow();
      expect(mailbox.last_synced_at).toBeNull();
    });
  });
});
