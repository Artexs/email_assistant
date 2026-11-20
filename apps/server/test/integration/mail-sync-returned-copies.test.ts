import { format } from "node:util";

import { HOUR_MS, MINUTE_MS } from "@ea/core";
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import type { Transaction } from "kysely";

import { syncMailbox, type MailboxSyncResult, type MailProvider } from "../../src/modules/mail";
import { createFakeMailProvider, type FakeMailProvider } from "../../src/modules/mail/fake";
import { RETURN_CHECK_LIMIT } from "../../src/modules/mail/sync";
import type { DB } from "../../src/platform/db";

import { insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import {
  UID_VALIDITY,
  type Setup,
  setup,
  NOW,
  hoursAgo,
  deps,
  seed,
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
  // The Interia shape with one UID counter for the mailbox (UIDs never collide across folders by chance).
  const interiaGlobal = (): FakeMailProvider =>
    createFakeMailProvider({
      uidValidity: UID_VALIDITY,
      globalUids: true,
      keepUidOnUserMove: true,
      capabilities: { move: false },
    });

  const skipLines = (lines: string[]): string[] =>
    lines.filter((line) => line.includes("sync_below_cursor_copy_skipped"));

  // The mail of the only row sits in AI/Info too (a copy at the folder UID); the row points at that UID.
  async function putInFolder(trx: Transaction<DB>, s: Setup): Promise<number> {
    const inFolder = s.fake.deliver("AI/Info", seed(1));
    await trx.updateTable("emails").set({ uid: inFolder }).where("mailbox_id", "=", s.mailboxId).execute();
    return inFolder;
  }

  test("3.1 a fresh move marker holds the copy back; an old marker does not", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      await storeAndMark(trx, s);
      const inFolder = s.fake.deliver("AI/Info", seed(1));
      await trx
        .updateTable("emails")
        .set({ uid: inFolder, move_pending_at: hoursAgo(1) })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      const [moved] = await copyRowsOf(trx, s.mailboxId);
      if (moved === undefined) throw new Error("no moved row");

      let held: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        held = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(held?.copiesBelowCursor).toBe(1);
      expect(held?.copiesStored).toBe(0);
      expect(held?.stored).toBe(0);
      expect(await copyRowsOf(trx, s.mailboxId)).toEqual([moved]);
      const skipped = skipLines(lines);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain("kind=move_in_flight");
      expect(skipped[0]).toContain(`email_id=${moved.id}`);

      await trx
        .updateTable("emails")
        .set({ move_pending_at: hoursAgo(25) })
        .where("id", "=", moved.id)
        .execute();
      const later = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(later.copiesBelowCursor).toBe(1);
      expect(later.copiesStored).toBe(1);
      const rows = await copyRowsOf(trx, s.mailboxId);
      expect(rows.map((row) => row.dedup_key)).toEqual([moved.dedup_key, `${moved.dedup_key}#2`]);
    });
  });

  test("3.4 a copy number that another row of the identity holds is not stored and raises no error", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      await storeAndMark(trx, s);
      await putInFolder(trx, s);
      const [moved] = await copyRowsOf(trx, s.mailboxId);
      if (moved === undefined) throw new Error("no moved row");
      const full = await trx.selectFrom("emails").selectAll().where("id", "=", moved.id).executeTakeFirstOrThrow();
      // Not moved, in a folder that no pass reads, so the count is 2 and the key #3 is taken.
      await insertTestEmail(trx, s.ctx, s.mailboxId, {
        dedup_key: `${moved.dedup_key}#3`,
        message_id_header: full.message_id_header,
        content_hash: full.content_hash,
        folder: "AI/Spam",
        source_folder: "AI/Spam",
        uid: 9000,
        source_uid: 9000,
      });

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(result?.copiesBelowCursor).toBe(1);
      expect(result?.copiesStored).toBe(0);
      expect(result?.stored).toBe(0);
      expect(await copyRowsOf(trx, s.mailboxId)).toHaveLength(2);
      const skipped = skipLines(lines);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain("kind=not_inserted");
      expect(skipped[0]).toContain(`email_id=${moved.id}`);
    });
  });

  // Two rows of one identity (#1, #2), both moved to AI/Info with an own folder UID, both originals still in INBOX.
  async function twoMovedRows(trx: Transaction<DB>, s: Setup): Promise<{ key: string; ids: string[] }> {
    s.fake.deliver("INBOX", seed(1));
    s.fake.deliver("INBOX", seed(1));
    await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
    const rows = await copyRowsOf(trx, s.mailboxId);
    expect(rows).toHaveLength(2);
    const ids: string[] = [];
    for (const row of rows) {
      const inFolder = s.fake.deliver("AI/Info", seed(1));
      await trx
        .updateTable("emails")
        .set({ folder: "AI/Info", uid: inFolder, moved_at: hoursAgo(rows.indexOf(row) === 0 ? 1 / 60 : 5) })
        .where("id", "=", row.id)
        .execute();
      ids.push(row.id);
    }
    return { key: rows[0]?.dedup_key ?? "", ids };
  }

  test("3.5 two moved rows of one identity: one sync stores #3 and #4", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interiaGlobal() };
      const { key } = await twoMovedRows(trx, s);

      const result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(result.copiesBelowCursor).toBe(2);
      expect(result.copiesStored).toBe(2);
      expect(result.stored).toBe(2);
      const rows = await copyRowsOf(trx, s.mailboxId);
      expect(rows.map((row) => row.dedup_key)).toEqual([key, `${key}#2`, `${key}#3`, `${key}#4`]);
    });
  });

  test("3.6 the two hits fall in two chunks: #3 and #4, no #5", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interiaGlobal() };
      const { key } = await twoMovedRows(trx, s);
      // Row 1 is the newest move, row 2 the oldest: 100 other moved rows sit between them.
      const [first, second] = await copyRowsOf(trx, s.mailboxId);
      await trx
        .updateTable("emails")
        .set({ moved_at: new Date(NOW.getTime() - MINUTE_MS) })
        .where("id", "=", first?.id ?? "")
        .execute();
      await trx
        .updateTable("emails")
        .set({ moved_at: new Date(NOW.getTime() - 5 * HOUR_MS) })
        .where("id", "=", second?.id ?? "")
        .execute();
      for (let n = 1; n <= 100; n += 1) {
        await insertTestEmail(trx, s.ctx, s.mailboxId, {
          dedup_key: `moved:${n}`,
          message_id_header: `<other${n}@x.test>`,
          folder: "AI/Info",
          uid: 10000 + n,
          source_uid: 10000 + n,
          moved_at: new Date(NOW.getTime() - (1 + n) * MINUTE_MS),
        });
      }
      const spy = spyFolderReads(s.fake);

      const result = await syncMailbox(deps(trx, spy.provider), s.ctx, s.mailboxId);
      expect(spy.folderCalls.filter((call) => call.folder === "INBOX" && call.method === "fetchByUidsIn")).toHaveLength(
        2
      );
      expect(result.copiesBelowCursor).toBe(2);
      expect(result.copiesStored).toBe(2);
      const rows = (await copyRowsOf(trx, s.mailboxId)).filter((row) => !row.dedup_key.startsWith("moved:"));
      expect(rows.map((row) => row.dedup_key)).toEqual([key, `${key}#2`, `${key}#3`, `${key}#4`]);
    });
  });

  test("3.7 a cursor moved during the check ends it: the copy is stored at the next run", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      await storeAndMark(trx, s);
      await putInFolder(trx, s);
      const provider: MailProvider = {
        ...s.fake,
        fetchByUidsIn: async (folder, uids) => {
          const metas = await s.fake.fetchByUidsIn(folder, uids);
          await trx
            .updateTable("mailbox_folders")
            .set({ last_uid: 99 })
            .where("mailbox_id", "=", s.mailboxId)
            .where("key", "=", "inbox")
            .execute();
          return metas;
        },
      };
      const warn = spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const result = await syncMailbox(deps(trx, provider), s.ctx, s.mailboxId);
        expect(result.copiesStored).toBe(0);
        expect(result.stored).toBe(0);
        expect(warn.mock.calls.map((call) => format(...call))).toContain(
          `[mail] sync_below_cursor_moved org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=inbox`
        );
      } finally {
        warn.mockRestore();
      }
      expect(await copyRowsOf(trx, s.mailboxId)).toHaveLength(1);

      const next = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      expect(next.copiesStored).toBe(1);
      expect(await copyRowsOf(trx, s.mailboxId)).toHaveLength(2);
    });
  });

  test("3.8 per-folder UIDs: another row of the identity with the hit UID number holds the copy back", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s);
      await putInFolder(trx, s);
      const [moved] = await copyRowsOf(trx, s.mailboxId);
      if (moved === undefined) throw new Error("no moved row");
      const full = await trx.selectFrom("emails").selectAll().where("id", "=", moved.id).executeTakeFirstOrThrow();
      // Not the same mail by chance of number alone: the rule cannot tell (accepted).
      await insertTestEmail(trx, s.ctx, s.mailboxId, {
        dedup_key: `${moved.dedup_key}#2`,
        message_id_header: full.message_id_header,
        content_hash: full.content_hash,
        folder: "AI/Spam",
        source_folder: "AI/Spam",
        uid,
        source_uid: uid,
      });
      const before = await copyRowsOf(trx, s.mailboxId);

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(result?.copiesBelowCursor).toBe(1);
      expect(result?.copiesStored).toBe(0);
      expect(result?.stored).toBe(0);
      expect(await copyRowsOf(trx, s.mailboxId)).toEqual(before);
      expect(before).toHaveLength(2);
      const skipped = skipLines(lines);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain("kind=held");
      expect(skipped[0]).toContain(`email_id=${moved.id}`);
    });
  });

  test("3.9 a hit found in the folder only at another UID is uncertain and not stored", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      await storeAndMark(trx, s);
      // An untracked identical twin in AI/Info; the row points at a UID where no mail is.
      const twin = s.fake.deliver("AI/Info", seed(1));
      await trx
        .updateTable("emails")
        .set({ uid: twin + 50 })
        .where("mailbox_id", "=", s.mailboxId)
        .execute();
      const before = await copyRowsOf(trx, s.mailboxId);
      const [moved] = before;
      if (moved === undefined) throw new Error("no moved row");

      let result: MailboxSyncResult | undefined;
      const lines = await withDebugLines(async () => {
        result = await syncMailbox(deps(trx, s.fake), s.ctx, s.mailboxId);
      });
      expect(result?.copiesBelowCursor).toBe(1);
      expect(result?.copiesStored).toBe(0);
      expect(result?.stored).toBe(0);
      expect(result?.returnedBelowCursor).toBe(0);
      expect(await copyRowsOf(trx, s.mailboxId)).toEqual(before);
      const skipped = skipLines(lines);
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain("kind=uncertain");
      expect(skipped[0]).toContain(`email_id=${moved.id}`);
    });
  });

  test("a full list warns about the limit", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      for (let n = 1; n <= RETURN_CHECK_LIMIT; n += 1) {
        await insertTestEmail(trx, s.ctx, s.mailboxId, {
          dedup_key: `moved:${n}`,
          message_id_header: `<moved${n}@x.test>`,
          folder: "AI/Info",
          uid: n,
          source_uid: n,
          moved_at: new Date(NOW.getTime() - n * 1000),
        });
      }
      const spy = spyFolderReads(s.fake);
      const warn = spyOn(console, "error").mockImplementation(() => undefined);
      try {
        await syncMailbox(deps(trx, spy.provider), s.ctx, s.mailboxId);
        expect(spy.folderCalls.filter((call) => call.method === "fetchByUidsIn")).toHaveLength(5);
        const lines = warn.mock.calls.map((call) => format(...call));
        expect(
          lines.some(
            (line) =>
              line.includes(`sync_below_cursor_limit`) && line.endsWith(`folder_key=inbox limit=${RETURN_CHECK_LIMIT}`)
          )
        ).toBe(true);
      } finally {
        warn.mockRestore();
      }
    });
  });

  test("a cursor moved during the check ends it: nothing is marked, no error", async () => {
    await withRollback(db, async (trx) => {
      const s = { ...(await setup(trx)), fake: interia() };
      const uid = await storeAndMark(trx, s);
      s.fake.userMove("INBOX", uid, "AI/Info");
      s.fake.userMove("AI/Info", uid, "INBOX");
      const provider: MailProvider = {
        ...s.fake,
        fetchByUidsIn: async (folder, uids) => {
          const metas = await s.fake.fetchByUidsIn(folder, uids);
          await trx
            .updateTable("mailbox_folders")
            .set({ last_uid: 99 })
            .where("mailbox_id", "=", s.mailboxId)
            .where("key", "=", "inbox")
            .execute();
          return metas;
        },
      };
      const warn = spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const result = await syncMailbox(deps(trx, provider), s.ctx, s.mailboxId);
        expect(result.returnedBelowCursor).toBe(0);
        expect(warn.mock.calls.map((call) => format(...call))).toContain(
          `[mail] sync_below_cursor_moved org_id=${s.ctx.orgId} mailbox_id=${s.mailboxId} folder_key=inbox`
        );
      } finally {
        warn.mockRestore();
      }
      const row = await movedRowOf(trx, s.mailboxId);
      expect(row).toMatchObject({ folder: "AI/Info", returned_at: null });
    });
  });
});
