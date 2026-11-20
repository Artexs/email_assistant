import { afterAll, describe, expect, test } from "bun:test";

import { syncMailbox, type MailProvider } from "../../src/modules/mail";
import type { TenantContext } from "../../src/platform/db";
import { SoftError } from "../../src/platform/errors";

import { insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  seed,
  OFFERS,
  JUNK,
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
  const SOCIAL = "Społeczności";
  const BILLS = "Rachunki";

  test("1. first run after the deploy: Oferty is added, only the last 24 h are stored, the cursor is the highest UID", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      s.fake.deliver(OFFERS, seed(1), ago(2));
      s.fake.deliver(OFFERS, seed(2), ago(20));
      const old = s.fake.deliver(OFFERS, seed(3), ago(30));

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
        expect(result.added).toEqual(["offers"]);
        expect(result.mode).toBe("incremental");
        expect(of(result, "offers")?.mode).toBe("initial");
        expect(result.failed).toEqual([]);
        expect(lines.info).toContain(
          `[mail] sync_folders_added org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} count=1`
        );
        expect(lines.info).toContain(
          `[mail] sync_folder_added org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=offers`
        );
      });
      const rows = await storedRows(trx, s.mailboxId);
      expect(rows.map((row) => row.subject)).toEqual(["Mail 1", "Mail 2"]);
      expect(rows.every((row) => row.folder === OFFERS && row.source_folder === OFFERS)).toBe(true);
      expect(rows.map((row) => Number(row.source_uid))).toEqual(rows.map((row) => Number(row.uid)));
      expect((await folderRow(trx, s.mailboxId, "offers"))?.lastUid).toBe(old);
    });
  });

  test("1b. the first VPS run: four default folders are added at once, INBOX stays incremental, AI/Spam is never synced", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await s.fake.ensureFolder("AI/Spam");
      // One UID counter: the UIDs interleave across the folders.
      s.fake.deliver(SOCIAL, seed(1), ago(100));
      const sourceUid = s.fake.deliver("INBOX", seed(2), ago(50));
      s.fake.deliver(OFFERS, seed(3), ago(60));
      s.fake.deliver(BILLS, seed(4), ago(90));
      s.fake.deliver(OFFERS, seed(5), ago(2));
      s.fake.deliver("AI/Spam", seed(6), ago(1));
      const socialTop = s.fake.deliver(SOCIAL, seed(7), ago(48));
      s.fake.deliver(OFFERS, seed(8), ago(5));
      const billsTop = s.fake.deliver(BILLS, seed(9), ago(30));
      const junkTop = s.fake.deliver(JUNK, seed(10), ago(80));
      const offersTop = s.fake.deliver(OFFERS, seed(11), ago(30));
      await trx
        .updateTable("mailbox_folders")
        .set({ last_uid: offersTop + 100 })
        .where("mailbox_id", "=", s.mailboxId)
        .where("key", "=", "inbox")
        .execute();
      await insertTestEmail(trx, s.ctx, s.mailboxId, {
        folder: "INBOX",
        uid: sourceUid,
        source_uid: sourceUid,
        subject: "Migrated",
      });

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
        expect(result.added).toEqual(["offers", "social", "bills", "junk"]);
        expect(result.failed).toEqual([]);
        expect(lines.info).toContain(
          `[mail] sync_folders_added org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} count=4`
        );
        expect(
          lines.info.filter((line) => line.includes("sync_folder_added")).map((line) => line.split(" ").pop())
        ).toEqual(["folder_key=offers", "folder_key=social", "folder_key=bills", "folder_key=junk"]);
        expect(result.folders.map((item) => item.folder)).toEqual(["inbox", "offers", "social", "bills", "junk"]);
        expect(of(result, "inbox")?.mode).toBe("incremental");
        expect(of(result, "offers")?.mode).toBe("initial");
        expect(of(result, "offers")?.stored).toBe(2);
        expect(of(result, "social")?.stored).toBe(0);
        expect(of(result, "bills")?.stored).toBe(0);
      });
      expect((await folderRow(trx, s.mailboxId, "offers"))?.lastUid).toBe(offersTop);
      expect((await folderRow(trx, s.mailboxId, "social"))?.lastUid).toBe(socialTop);
      expect((await folderRow(trx, s.mailboxId, "bills"))?.lastUid).toBe(billsTop);
      expect((await folderRow(trx, s.mailboxId, "junk"))?.lastUid).toBe(junkTop);
      const rows = await storedRows(trx, s.mailboxId);
      expect(rows.filter((row) => row.folder !== "INBOX").map((row) => row.subject)).toEqual(["Mail 5", "Mail 8"]);
      expect(rows.some((row) => row.folder === "AI/Spam")).toBe(false);
      expect(s.fake.folderCalls.some((call) => call.folder === "AI/Spam" && call.method !== "ensureFolder")).toBe(
        false
      );
    });
  });

  test("2. a spam folder without mail in 24 h stores nothing and its cursor is the highest UID", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      for (const n of [1, 2, 3]) s.fake.deliver(JUNK, seed(n), ago(72));

      const first = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(first.added).toEqual(["junk"]);
      expect(first.stored).toBe(0);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(0);
      expect((await folderRow(trx, s.mailboxId, "junk"))?.lastUid).toBe(3);

      const second = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(second, "junk")?.mode).toBe("incremental");
      expect(of(second, "junk")?.stored).toBe(0);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(0);
    });
  });

  test("3. a new mail in Społeczności above its cursor is stored pending, with the body read from that folder", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "social", SOCIAL, { lastUid: 0 });
      const uid = s.fake.deliver(SOCIAL, seed(1), ago(1));

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(of(result, "social")?.stored).toBe(1);
      const rows = await storedRows(trx, s.mailboxId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ folder: SOCIAL, source_folder: SOCIAL, status: "pending", uid: String(uid) });
      expect(s.fake.folderCalls).toContainEqual({ method: "fetchContent", folder: SOCIAL });
    });
  });

  test("4. a disabled junk row is not synced and discovery does not enable it", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "junk", JUNK, { enabled: false, lastUid: 0 });
      s.fake.deliver(JUNK, seed(1), ago(1));

      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.added).toEqual([]);
      expect(result.folders.map((item) => item.folder)).toEqual(["inbox"]);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(0);
      expect(await folderRow(trx, s.mailboxId, "junk")).toEqual({ uidValidity: 1, lastUid: 0, enabled: false });
      expect(s.fake.folderCalls.some((call) => call.method === "folderStatus" && call.folder === JUNK)).toBe(false);
    });
  });

  test("5. a row whose path the server does not list is skipped with one warn line", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "bills", BILLS, { lastUid: 0 });
      s.fake.deliver("INBOX", seed(1), ago(1));

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
        expect(result.skipped).toEqual(["bills"]);
        expect(result.failed).toEqual([]);
        expect(result.stored).toBe(1);
        expect(lines.warn).toEqual([
          `[mail] sync_folder_missing org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=bills`,
        ]);
      });
    });
  });

  test("6. a SoftError in the Oferty read fails only that folder; the next run stores its mail once", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      await addFolderRow(trx, s, "junk", JUNK, { lastUid: 0 });
      s.fake.deliver("INBOX", seed(1), ago(1));
      s.fake.deliver(OFFERS, seed(2), ago(1));
      s.fake.deliver(JUNK, seed(3), ago(1));
      let broken = true;
      const provider: MailProvider = {
        ...s.fake,
        fetchAbove: async (folder, lastUid) => {
          if (broken && folder === OFFERS) throw new SoftError("lost connection for MARKER-ADDR@x.test");
          return s.fake.fetchAbove(folder, lastUid);
        },
      };

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
        expect(result.stored).toBe(1);
        expect(result.failed).toEqual(["offers"]);
        expect(of(result, "junk")?.stored).toBe(1);
        expect(lines.warn).toContain(
          `[mail] sync_folder_soft_error org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=offers error=SoftError`
        );
        expect([...lines.warn, ...lines.info].join("\n")).not.toContain("MARKER");
      });
      expect((await folderRow(trx, s.mailboxId, "offers"))?.lastUid).toBe(0);

      broken = false;
      const next = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
      expect(next.failed).toEqual([]);
      expect(of(next, "offers")?.stored).toBe(1);
      expect((await storedRows(trx, s.mailboxId)).filter((row) => row.folder === OFFERS)).toHaveLength(1);
    });
  });

  test("7. a SoftError in INBOX stops the run before any other folder", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver(OFFERS, seed(1), ago(1));
      s.fake.failOn("fetchAbove", new SoftError("lost connection"));

      await expect(syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId)).rejects.toBeInstanceOf(SoftError);
      expect(s.fake.folderCalls.some((call) => call.folder === OFFERS)).toBe(false);
    });
  });

  test("8. a UIDVALIDITY change in Oferty rescans only that folder and gives its known rows the new UIDs", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver(OFFERS, seed(1), ago(1));
      s.fake.deliver(OFFERS, seed(2), ago(30));
      await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(2);

      s.fake.resetUidValidity(9, OFFERS);
      const result = await syncMailbox(folderDeps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.mode).toBe("incremental");
      const offers = of(result, "offers");
      expect(offers?.mode).toBe("rescan");
      expect(offers?.stored).toBe(0);
      expect(offers?.uidUpdated).toBe(2);
      const rows = await storedRows(trx, s.mailboxId);
      expect(rows).toHaveLength(2);
      const uids = (await s.fake.fetchAbove(OFFERS, 0)).map((meta) => meta.uid);
      expect(rows.map((row) => Number(row.uid))).toEqual(uids);
      expect(rows.map((row) => Number(row.source_uid))).toEqual(uids);
      expect((await folderRow(trx, s.mailboxId, "offers"))?.uidValidity).toBe(9);
    });
  });

  test("9. a CursorMovedError in the Oferty chunk fails only that folder", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      await addFolderRow(trx, s, "junk", JUNK, { lastUid: 0 });
      s.fake.deliver(OFFERS, seed(1), ago(1));
      s.fake.deliver(JUNK, seed(2), ago(1));
      const provider: MailProvider = {
        ...s.fake,
        fetchContent: async (folder, uid) => {
          if (folder === OFFERS) {
            await trx
              .updateTable("mailbox_folders")
              .set({ last_uid: 99 })
              .where("mailbox_id", "=", s.mailboxId)
              .where("key", "=", "offers")
              .execute();
          }
          return s.fake.fetchContent(folder, uid);
        },
      };

      await withLogs(async (lines) => {
        const result = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
        expect(result.failed).toEqual(["offers"]);
        expect(of(result, "junk")?.stored).toBe(1);
        expect(lines.warn).toContain(
          `[mail] sync_folder_soft_error org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=offers error=CursorMovedError`
        );
      });
      expect((await storedRows(trx, s.mailboxId)).map((row) => row.folder)).toEqual([JUNK]);
    });
  });

  test("10. a crash before the Oferty commit leaves no row and no cursor; the next run stores the mail once", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      s.fake.deliver(OFFERS, seed(1), ago(1));
      let crash = true;
      const provider: MailProvider = {
        ...s.fake,
        fetchContent: async (folder, uid) => {
          const body = await s.fake.fetchContent(folder, uid);
          if (crash && folder === OFFERS) throw new SoftError("crash after the plan");
          return body;
        },
      };

      const first = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
      expect(first.failed).toEqual(["offers"]);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(0);
      expect(await folderRow(trx, s.mailboxId, "offers")).toEqual({ uidValidity: null, lastUid: null, enabled: true });

      crash = false;
      const second = await syncMailbox(folderDeps(trx, provider), s.ctx, s.mailboxId);
      expect(of(second, "offers")?.stored).toBe(1);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(1);
    });
  });

  test("11. an own sent mail in Oferty is skipped", async () => {
    await withRollback(db, async (trx) => {
      const s = await folderSetup(trx);
      await addFolderRow(trx, s, "offers", OFFERS, { lastUid: 0 });
      s.fake.deliver(OFFERS, seed(1, { headers: { "X-EA-Action-Id": "act-1" } }), ago(1));
      const isOwnActionId = async (_ctx: TenantContext, _mailboxId: string, actionId: string) => actionId === "act-1";

      const result = await syncMailbox(folderDeps(trx, s.fake, { isOwnActionId }), s.ctx, s.mailboxId);
      expect(of(result, "offers")?.skippedOwn).toBe(1);
      expect(await storedRows(trx, s.mailboxId)).toHaveLength(0);
    });
  });
});
