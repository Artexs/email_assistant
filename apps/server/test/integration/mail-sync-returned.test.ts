import { MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";

import { syncMailbox, type MailboxSyncResult } from "../../src/modules/mail";

import { insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  setup,
  NOW,
  hoursAgo,
  deps,
  seed,
  emails,
  cursorOf,
  onBodyCall,
  spyFolderReads,
  movedRowOf,
  copyRowsOf,
  withDebugLines,
  interia,
  storeAndMark,
} from "./mail-sync-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("syncMailbox: returned mail below the cursor", () => {
  test("a user move back that keeps the uid sets returned_at after the folder check found nothing", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s);
      expect(s.fake.userMove("INBOX", uid, "AI/Info")).toBe(uid);
      expect(s.fake.userMove("AI/Info", uid, "INBOX")).toBe(uid);
      const before = await cursorOf(trx, s.mailboxId);
      const spy = spyFolderReads(s.fake);

      const result = await syncMailbox(deps(trx, spy.provider), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(1);
      expect(result.copiesBelowCursor).toBe(0);
      expect(result.returned).toBe(0);
      expect(result.stored).toBe(0);
      const row = await movedRowOf(trx, s.mailboxId);
      expect(row.returned_at).toBeInstanceOf(Date);
      expect(row).toMatchObject({ folder: "INBOX", uid, source_uid: uid });
      expect(await cursorOf(trx, s.mailboxId)).toEqual(before);
      expect(await emails(trx, s.mailboxId)).toHaveLength(1);
      expect(spy.folderCalls.filter((call) => call.folder === "AI/Info").map((call) => call.method)).toEqual([
        "fetchMetaIn",
        "searchSinceIn",
      ]);
    });
  });

  test("a copy back to INBOX that leaves the mail in its folder is stored as #2", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s);
      const inFolder = s.fake.deliver("AI/Info", seed(1));
      await trx.updateTable("emails").set({ uid: inFolder }).where("mailbox_id", "=", s.mailboxId).execute();
      const [moved] = await copyRowsOf(trx, s.mailboxId);
      const before = await cursorOf(trx, s.mailboxId);
      const copyMeta = await s.fake.fetchMetaIn("INBOX", uid);

      let result: MailboxSyncResult | undefined;
      const debugLines = await withDebugLines(async () => {
        result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(debugLines.filter((line) => line.includes("sync_below_cursor_copy "))).toEqual([
        `[mail] sync_below_cursor_copy org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} email_id=${moved?.id}`,
      ]);
      if (result === undefined) throw new Error("no result");
      expect(result.copiesBelowCursor).toBe(1);
      expect(result.copiesStored).toBe(1);
      expect(result.stored).toBe(1);
      expect(result.captureMissing).toBe(0);
      expect(result.returnedBelowCursor).toBe(0);

      const rows = await copyRowsOf(trx, s.mailboxId);
      expect(rows).toHaveLength(2);
      const copy = rows.find((row) => row.id !== moved?.id);
      expect(copy).toMatchObject({
        dedup_key: `${moved?.dedup_key}#2`,
        folder: "INBOX",
        source_folder: "INBOX",
        uid,
        source_uid: uid,
        status: "pending",
        body_text: "Body 1",
        returned_at: null,
      });
      expect(copy?.received_at.getTime()).toBe(copyMeta?.internalDate.getTime());
      // The copy has a capture row (2.5).
      expect(copy?.header_id).toBe(copy?.id);
      expect(rows.find((row) => row.id === moved?.id)).toEqual(moved);
      expect(await cursorOf(trx, s.mailboxId)).toEqual(before);

      // A second sync counts and stores nothing (2.2).
      const info = await withDebugLines(async () => {
        const again = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
        expect(again.copiesBelowCursor).toBe(0);
        expect(again.copiesStored).toBe(0);
        expect(again.stored).toBe(0);
        expect(again.returnedBelowCursor).toBe(0);
      });
      expect(
        info.some((line) =>
          line.endsWith(
            `sync_below_cursor_done org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=inbox checked=1 returned=0 copies=0`
          )
        )
      ).toBe(true);
      expect(info.some((line) => line.includes("sync_below_cursor_copies_stored"))).toBe(false);
      expect(await copyRowsOf(trx, s.mailboxId)).toHaveLength(2);
    });
  });

  test("a stored copy logs the stored count once and no skip line", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      await storeAndMark(trx, s);
      const inFolder = s.fake.deliver("AI/Info", seed(1));
      await trx.updateTable("emails").set({ uid: inFolder }).where("mailbox_id", "=", s.mailboxId).execute();

      const lines = await withDebugLines(async () => {
        await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      });
      const stored = lines.filter((line) => line.includes("sync_below_cursor_copies_stored"));
      expect(stored).toHaveLength(1);
      expect(stored[0]).toContain(`mailbox_id=${s.mailboxId}`);
      expect(stored[0]).toContain("folder_key=inbox");
      expect(stored[0]).toContain("count=1");
      expect(lines.some((line) => line.includes("sync_below_cursor_copy_skipped"))).toBe(false);
    });
  });

  test("a copy that another run stored while this check fetched the body is not stored again", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s);
      const inFolder = s.fake.deliver("AI/Info", seed(1));
      await trx.updateTable("emails").set({ uid: inFolder }).where("mailbox_id", "=", s.mailboxId).execute();
      const [moved] = await copyRowsOf(trx, s.mailboxId);
      if (moved === undefined) throw new Error("no moved row");
      const full = await trx.selectFrom("emails").selectAll().where("id", "=", moved.id).executeTakeFirstOrThrow();
      const provider = onBodyCall(s.fake, async () => {
        await insertTestEmail(trx, s.ctx, s.mailboxId, {
          // Another number than the planned #2: only the re-check inside the lock stops this check.
          dedup_key: `${moved.dedup_key}#3`,
          message_id_header: full.message_id_header,
          content_hash: full.content_hash,
          folder: "INBOX",
          uid,
          source_uid: uid,
        });
      });

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(deps(trx, provider), s.ctx, s.mailboxId);
      });
      expect(result?.copiesBelowCursor).toBe(1);
      expect(result?.copiesStored).toBe(0);
      expect(result?.stored).toBe(0);
      const rows = await copyRowsOf(trx, s.mailboxId);
      expect(rows.filter((row) => row.folder === "INBOX")).toHaveLength(1);
      expect(rows).toHaveLength(2);
      const skipped = lines.filter((line) => line.includes("sync_below_cursor_copy_skipped"));
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain("kind=held");
      // The id is the moved row's id, never a run id (a run id holds the Message-ID).
      expect(skipped[0]).toContain(`email_id=${moved.id}`);
      expect(skipped[0]).toContain(`mailbox_id=${s.mailboxId}`);
    });
  });

  test("a copy whose mail gets an Undo marker while this check fetched the body is not stored", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      await storeAndMark(trx, s);
      const inFolder = s.fake.deliver("AI/Info", seed(1));
      await trx.updateTable("emails").set({ uid: inFolder }).where("mailbox_id", "=", s.mailboxId).execute();
      const [moved] = await copyRowsOf(trx, s.mailboxId);
      const provider = onBodyCall(s.fake, async () => {
        await trx
          .updateTable("emails")
          .set({ move_pending_at: NOW })
          .where("id", "=", moved?.id ?? "")
          .execute();
      });

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(deps(trx, provider), s.ctx, s.mailboxId);
      });
      expect(result?.copiesStored).toBe(0);
      expect(result?.stored).toBe(0);
      expect(await copyRowsOf(trx, s.mailboxId)).toHaveLength(1);
      const skipped = lines.filter((line) => line.includes("sync_below_cursor_copy_skipped"));
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain("kind=move_in_flight");
      expect(skipped[0]).toContain(`email_id=${moved?.id}`);
    });
  });

  test("an identical copy that stays in INBOX at the hit uid is no return", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s);
      const moved = await trx
        .selectFrom("emails")
        .selectAll()
        .where("mailbox_id", "=", s.mailboxId)
        .executeTakeFirstOrThrow();
      await insertTestEmail(trx, s.ctx, s.mailboxId, {
        message_id_header: moved.message_id_header,
        content_hash: moved.content_hash,
        folder: "INBOX",
        uid,
        source_uid: uid,
      });

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(0);
      expect(result.copiesBelowCursor).toBe(0);
      const after = await trx.selectFrom("emails").selectAll().where("id", "=", moved.id).executeTakeFirstOrThrow();
      expect(after).toEqual(moved);
    });
  });

  test("a mail back at its uid with \\Deleted is no hit and gets no folder check", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s);
      s.fake.userMove("INBOX", uid, "AI/Info");
      s.fake.userMove("AI/Info", uid, "INBOX");
      await s.fake.setFlags("INBOX", uid, { add: ["\\Deleted"] });
      const spy = spyFolderReads(s.fake);

      const result = await syncMailbox(deps(trx, spy.provider), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(0);
      expect(result.copiesBelowCursor).toBe(0);
      expect(spy.folderCalls.map((call) => call.method)).toEqual(["fetchByUidsIn"]);
      expect((await movedRowOf(trx, s.mailboxId)).returned_at).toBeNull();
    });
  });

  test("a move older than 7 days is not checked", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s, hoursAgo(8 * 24));
      s.fake.userMove("INBOX", uid, "AI/Info");
      s.fake.userMove("AI/Info", uid, "INBOX");
      const spy = spyFolderReads(s.fake);

      const result = await syncMailbox(deps(trx, spy.provider), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(0);
      expect(spy.folderCalls).toEqual([]);
      expect((await movedRowOf(trx, s.mailboxId)).returned_at).toBeNull();
    });
  });

  test("a row with folder INBOX is not in the list", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      s.fake.deliver("INBOX", seed(1));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      await trx
        .updateTable("emails")
        .set({ moved_at: hoursAgo(1) })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      const spy = spyFolderReads(s.fake);

      const result = await syncMailbox(deps(trx, spy.provider), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(0);
      expect(spy.folderCalls).toEqual([]);
    });
  });

  test("120 moved rows give two fetchByUidsIn calls; the first holds the newest rows", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      for (let n = 1; n <= 120; n += 1) {
        await insertTestEmail(trx, s.ctx, s.mailboxId, {
          dedup_key: `moved:${n}`,
          message_id_header: `<moved${n}@x.test>`,
          folder: "AI/Info",
          uid: n,
          source_uid: n,
          moved_at: new Date(NOW.getTime() - n * MINUTE_MS),
        });
      }
      const spy = spyFolderReads(s.fake);

      const result = await syncMailbox(deps(trx, spy.provider), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(0);
      expect(spy.folderCalls.map((call) => call.method)).toEqual(["fetchByUidsIn", "fetchByUidsIn"]);
      expect(spy.folderCalls.map((call) => call.folder)).toEqual(["INBOX", "INBOX"]);
      expect(spy.folderCalls[0]?.uids).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
      expect(spy.folderCalls[1]?.uids).toEqual(Array.from({ length: 20 }, (_, i) => i + 101));
    });
  });

  test("another mail at the uid of a moved row is no return", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = s.fake.deliver("INBOX", seed(2));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      const movedId = await insertTestEmail(trx, s.ctx, s.mailboxId, {
        dedup_key: "moved:1",
        message_id_header: "<m1@x.test>",
        folder: "AI/Info",
        uid: 1,
        source_uid: uid,
        moved_at: hoursAgo(1),
      });

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(0);
      expect(result.copiesBelowCursor).toBe(0);
      const row = await trx
        .selectFrom("emails")
        .select(["returned_at", "folder"])
        .where("id", "=", movedId)
        .executeTakeFirstOrThrow();
      expect(row).toEqual({ returned_at: null, folder: "AI/Info" });
    });
  });

  test("RFC shape: a returned mail above the cursor is marked once by the normal path", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const uid = await storeAndMark(trx, s);
      const inFolder = s.fake.userMove("INBOX", uid, "AI/Info");
      await trx.updateTable("emails").set({ uid: inFolder }).where("mailbox_id", "=", s.mailboxId).execute();
      const back = s.fake.userMove("AI/Info", inFolder, "INBOX");
      expect(back).toBeGreaterThan(uid);

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returned).toBe(1);
      expect(result.returnedBelowCursor).toBe(0);
      const row = await movedRowOf(trx, s.mailboxId);
      expect(row.returned_at).toBeInstanceOf(Date);
      expect(row).toMatchObject({ folder: "INBOX", uid: back, source_uid: back });
    });
  });

  test("the system COPY shape: the folder uid differs, the cursor passed it, the user move back is found", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const sourceUid = s.fake.deliver("INBOX", seed(1));
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      // Three mails in AI/Info already: the system COPY gives the moved mail the folder uid 4.
      for (const n of [11, 12, 13]) s.fake.deliver("AI/Info", seed(n));
      const folderUid = s.fake.userMove("INBOX", sourceUid, "AI/Info");
      expect(folderUid).toBe(4);
      expect(folderUid).not.toBe(sourceUid);
      await trx
        .updateTable("emails")
        .set({ folder: "AI/Info", uid: folderUid, moved_at: hoursAgo(1) })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      // New INBOX mail moves the cursor past the folder uid; the INBOX uid 4 stays free.
      for (const n of [2, 3, 4, 5, 6]) s.fake.deliver("INBOX", seed(n));
      s.fake.remove("INBOX", 4);
      await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect((await cursorOf(trx, s.mailboxId)).lastUid).toBeGreaterThan(folderUid);

      expect(s.fake.userMove("AI/Info", folderUid, "INBOX")).toBe(folderUid);
      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.returnedBelowCursor).toBe(1);
      expect(result.copiesBelowCursor).toBe(0);
      const row = await trx
        .selectFrom("emails")
        .select(["uid", "source_uid", "folder", "returned_at"])
        .where("mailbox_id", "=", s.mailboxId)
        .where("folder", "=", "INBOX")
        .where("returned_at", "is not", null)
        .executeTakeFirstOrThrow();
      expect({ uid: Number(row.uid), source_uid: Number(row.source_uid), folder: row.folder }).toEqual({
        uid: folderUid,
        source_uid: folderUid,
        folder: "INBOX",
      });
      expect(row.returned_at).toBeInstanceOf(Date);
    });
  });
});
