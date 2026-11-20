import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import type { NewEmail } from "../../src/modules/mail";
import {
  findCopies,
  insertEmail,
  listFolderUids,
  listRecentlyMoved,
  markEmailRelocated,
  markEmailReturned,
  setMovePending,
  updateEmailUid,
} from "../../src/modules/mail/repo";
import type { DB } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";
import { createTwoTenants, emailRow, newEmail, type Tenant } from "./mail-repo-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

async function sourceUidOf(trx: Transaction<DB>, emailId: string) {
  const row = await trx.selectFrom("emails").select("source_uid").where("id", "=", emailId).executeTakeFirstOrThrow();
  return row.source_uid;
}

describe("mail repository: emails", () => {
  test("insertEmail returns true, then false for the same dedup key, and stores the org_id of the context", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      expect(await insertEmail(trx, a.ctx, newEmail(a.mailboxId))).toBe(true);
      expect(await insertEmail(trx, a.ctx, newEmail(a.mailboxId, { uid: 2 }))).toBe(false);
      const row = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      expect(row.org_id).toBe(a.ctx.orgId);
      expect(Number(row.uid)).toBe(1);
      expect(row.status).toBe("pending");
    });
  });

  test("insertEmail with the context of B and the mailbox of A fails with 23503", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await sql`savepoint cross_org_email`.execute(trx);
      await expect(insertEmail(trx, b.ctx, newEmail(a.mailboxId))).rejects.toMatchObject({ code: "23503" });
      await sql`rollback to savepoint cross_org_email`.execute(trx);
    });
  });

  test("findCopies matches Message-ID and hash, finds only rows with no Message-ID for null, and filters by org_id", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId));
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId, { dedup_key: "mid:<1@x.test>:hash-1#2", folder: "AI/Info" }));
      await insertEmail(
        trx,
        a.ctx,
        newEmail(a.mailboxId, { dedup_key: "mid:<1@x.test>:hash-2", content_hash: "hash-2" })
      );
      await insertEmail(
        trx,
        a.ctx,
        newEmail(a.mailboxId, { dedup_key: "hash:hash-1", message_id_header: null, thread_key: "hash:hash-1" })
      );

      const withId = await findCopies(trx, a.ctx, a.mailboxId, { messageId: "<1@x.test>", contentHash: "hash-1" });
      expect(
        withId
          .map((c) => ({ dedupKey: c.dedupKey, folder: c.folder }))
          .sort((x, y) => x.dedupKey.localeCompare(y.dedupKey))
      ).toEqual([
        { dedupKey: "mid:<1@x.test>:hash-1", folder: "INBOX" },
        { dedupKey: "mid:<1@x.test>:hash-1#2", folder: "AI/Info" },
      ]);
      expect(withId.every((c) => typeof c.id === "string")).toBe(true);

      const withoutId = await findCopies(trx, a.ctx, a.mailboxId, { messageId: null, contentHash: "hash-1" });
      expect(withoutId.map((c) => c.dedupKey)).toEqual(["hash:hash-1"]);

      expect(await findCopies(trx, b.ctx, a.mailboxId, { messageId: "<1@x.test>", contentHash: "hash-1" })).toEqual([]);
      expect(await findCopies(trx, b.ctx, a.mailboxId, { messageId: null, contentHash: "hash-1" })).toEqual([]);
    });
  });

  test("insertEmail sets source_uid to uid", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId, { uid: 7 }));
      const row = await trx
        .selectFrom("emails")
        .select(["uid", "source_uid"])
        .where("mailbox_id", "=", a.mailboxId)
        .executeTakeFirstOrThrow();
      expect({ uid: Number(row.uid), sourceUid: Number(row.source_uid) }).toEqual({ uid: 7, sourceUid: 7 });
    });
  });

  test("setMovePending writes move_pending_at, and null clears it", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId));
      const { id } = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      const stamp = new Date("2026-11-20T10:00:00Z");
      const read = () =>
        trx.selectFrom("emails").select("move_pending_at").where("id", "=", id).executeTakeFirstOrThrow();

      await setMovePending(trx, a.ctx, id, stamp);
      expect(await read()).toEqual({ move_pending_at: stamp });

      await setMovePending(trx, a.ctx, id, null);
      expect(await read()).toEqual({ move_pending_at: null });
    });
  });

  test("findCopies returns uid, content hash, from and received_at", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId, { uid: 9 }));
      const [copy] = await findCopies(trx, a.ctx, a.mailboxId, { messageId: "<1@x.test>", contentHash: "hash-1" });
      expect(copy).toMatchObject({
        uid: 9,
        contentHash: "hash-1",
        from: "sender@x.test",
        receivedAt: new Date("2026-11-03T10:00:00Z"),
      });
    });
  });

  test("listFolderUids returns the UIDs of the other rows in that folder, filtered by org and mailbox", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId, { uid: 5, folder: "AI/Spam" }));
      await insertEmail(
        trx,
        a.ctx,
        newEmail(a.mailboxId, { dedup_key: "mid:<1@x.test>:hash-1#2", uid: 6, folder: "AI/Spam" })
      );
      await insertEmail(
        trx,
        a.ctx,
        newEmail(a.mailboxId, { dedup_key: "mid:<1@x.test>:hash-1#3", uid: 7, folder: "AI/Info" })
      );
      const { id } = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      const key = { exceptEmailId: id, messageId: "<1@x.test>", contentHash: "hash-1" };

      expect(await listFolderUids(trx, a.ctx, a.mailboxId, "AI/Spam", key)).toEqual(new Set([6]));
      expect(await listFolderUids(trx, a.ctx, a.mailboxId, "AI/Info", key)).toEqual(new Set([7]));
      expect(await listFolderUids(trx, b.ctx, a.mailboxId, "AI/Spam", key)).toEqual(new Set());
      expect(await listFolderUids(trx, a.ctx, b.mailboxId, "AI/Spam", key)).toEqual(new Set());
    });
  });

  test("listRecentlyMoved filters by org, mailbox, folder, source_uid and window, newest moved_at first, and limits", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const at = (hour: number) => new Date(Date.UTC(2026, 10, 3, hour));
      const add = async (tenant: Tenant, n: number, overrides: Partial<NewEmail>, movedAt: Date | null) => {
        await insertEmail(
          trx,
          tenant.ctx,
          newEmail(tenant.mailboxId, { dedup_key: `mid:<${n}@x.test>:h`, uid: n, ...overrides })
        );
        await trx
          .updateTable("emails")
          .set({ moved_at: movedAt })
          .where("mailbox_id", "=", tenant.mailboxId)
          .where("dedup_key", "=", `mid:<${n}@x.test>:h`)
          .execute();
      };
      await add(a, 1, { folder: "AI/Info" }, at(8));
      await add(a, 2, { folder: "AI/Info" }, at(10));
      await add(a, 3, { folder: "AI/Spam" }, at(9));
      await add(a, 4, { folder: "AI/Info" }, at(5)); // before the window
      await add(a, 5, { folder: "INBOX" }, at(11)); // in INBOX
      await add(a, 6, { folder: "AI/Info" }, null); // never moved
      await add(b, 7, { folder: "AI/Info" }, at(11)); // other tenant
      await trx
        .updateTable("emails")
        .set({ source_uid: null })
        .where("mailbox_id", "=", a.mailboxId)
        .where("dedup_key", "=", "mid:<3@x.test>:h")
        .execute();
      await add(a, 8, { folder: "AI/Info" }, at(7));

      const all = await listRecentlyMoved(trx, a.ctx, a.mailboxId, {
        sourceFolder: "INBOX",
        movedAfter: at(6),
        limit: 10,
      });
      expect(all.map((row) => row.uid)).toEqual([2, 1, 8]);
      expect(all[0]).toMatchObject({ folder: "AI/Info", source_uid: 2, moved_at: at(10) });
      const limited = await listRecentlyMoved(trx, a.ctx, a.mailboxId, {
        sourceFolder: "INBOX",
        movedAfter: at(6),
        limit: 2,
      });
      expect(limited.map((row) => row.uid)).toEqual([2, 1]);
      expect(
        await listRecentlyMoved(trx, b.ctx, a.mailboxId, { sourceFolder: "INBOX", movedAfter: at(6), limit: 10 })
      ).toEqual([]);
      expect(
        await listRecentlyMoved(trx, a.ctx, b.mailboxId, { sourceFolder: "INBOX", movedAfter: at(6), limit: 10 })
      ).toEqual([]);
    });
  });

  test("listRecentlyMoved with a sort folder source leaves out other sources, rows in their source, old rows and other orgs", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const at = (hour: number) => new Date(Date.UTC(2026, 10, 3, hour));
      const add = async (tenant: Tenant, n: number, overrides: Partial<NewEmail>, movedAt: Date) => {
        await insertEmail(
          trx,
          tenant.ctx,
          newEmail(tenant.mailboxId, { dedup_key: `mid:<${n}@x.test>:h`, uid: n, ...overrides })
        );
        await trx
          .updateTable("emails")
          .set({ moved_at: movedAt })
          .where("mailbox_id", "=", tenant.mailboxId)
          .where("dedup_key", "=", `mid:<${n}@x.test>:h`)
          .execute();
      };
      await add(a, 1, { folder: "AI/Info", source_folder: "Oferty" }, at(8));
      await add(a, 2, { folder: "INBOX", source_folder: "Oferty" }, at(10)); // a row that the system moved into INBOX
      await add(a, 3, { folder: "AI/Info", source_folder: "INBOX" }, at(9)); // source INBOX
      await add(a, 4, { folder: "Oferty", source_folder: "Oferty" }, at(11)); // in its source
      await add(a, 5, { folder: "AI/Info", source_folder: "Oferty" }, at(5)); // before the window
      await add(b, 6, { folder: "AI/Info", source_folder: "Oferty" }, at(11)); // other tenant

      const rows = await listRecentlyMoved(trx, a.ctx, a.mailboxId, {
        sourceFolder: "Oferty",
        movedAfter: at(6),
        limit: 10,
      });
      expect(rows.map((row) => row.uid)).toEqual([2, 1]);
      expect(
        await listRecentlyMoved(trx, b.ctx, a.mailboxId, { sourceFolder: "Oferty", movedAfter: at(6), limit: 10 })
      ).toEqual([]);
    });
  });

  test("updateEmailUid changes 0 rows of another organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId));
      const { id } = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");

      await updateEmailUid(trx, b.ctx, id, 50, { folder: "INBOX" });
      expect(Number((await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1")).uid)).toBe(1);

      await updateEmailUid(trx, a.ctx, id, 50, { folder: "INBOX" });
      expect(Number((await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1")).uid)).toBe(50);
      expect(Number(await sourceUidOf(trx, id))).toBe(50);
    });
  });

  test("updateEmailUid changes 0 rows when the row left the folder of the decision", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId, { folder: "AI/Info" }));
      const { id } = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");

      expect(await updateEmailUid(trx, a.ctx, id, 50, { folder: "Oferty" })).toBe(false);
      expect(Number((await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1")).uid)).toBe(1);
      expect(await updateEmailUid(trx, a.ctx, id, 50, { folder: "AI/Info" })).toBe(true);
    });
  });

  test("markEmailReturned sets returned_at, folder and uid, and changes 0 rows of another organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId, { folder: "AI/Info" }));
      const { id } = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      const at = new Date("2026-11-03T13:00:00Z");

      expect(await markEmailReturned(trx, b.ctx, id, 60, at, { folder: "INBOX" })).toBe(false);
      let row = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      expect({ folder: row.folder, uid: Number(row.uid), returnedAt: row.returned_at }).toEqual({
        folder: "AI/Info",
        uid: 1,
        returnedAt: null,
      });

      expect(await markEmailReturned(trx, a.ctx, id, 60, at, { folder: "INBOX" })).toBe(true);
      row = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      expect({ folder: row.folder, uid: Number(row.uid), returnedAt: row.returned_at, status: row.status }).toEqual({
        folder: "INBOX",
        uid: 60,
        returnedAt: at,
        status: "pending",
      });
      expect(Number(await sourceUidOf(trx, id))).toBe(60);

      // The guard is always on: a row with folder = source_folder stays as it is.
      const later = new Date("2026-11-03T14:00:00Z");
      expect(await markEmailReturned(trx, a.ctx, id, 70, later, { folder: "INBOX" })).toBe(false);
      row = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      expect({ uid: Number(row.uid), returnedAt: row.returned_at }).toEqual({ uid: 60, returnedAt: at });
    });
  });

  test("markEmailReturned into another synced folder sets folder and source_folder", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId, { folder: "AI/Info" }));
      const { id } = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      const at = new Date("2026-11-03T13:00:00Z");

      expect(await markEmailReturned(trx, a.ctx, id, 60, at, { folder: "Oferty" })).toBe(true);
      const row = await trx
        .selectFrom("emails")
        .select(["folder", "source_folder", "uid", "source_uid", "returned_at"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect({ ...row, uid: Number(row.uid), source_uid: Number(row.source_uid) }).toEqual({
        folder: "Oferty",
        source_folder: "Oferty",
        uid: 60,
        source_uid: 60,
        returned_at: at,
      });
    });
  });

  test("markEmailRelocated moves folder, source_folder and uids only from the given folder, and filters by org_id", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId));
      const { id } = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      const change = { from: "INBOX", to: "Oferty", uid: 80 };
      const read = () =>
        trx
          .selectFrom("emails")
          .select(["folder", "source_folder", "uid", "source_uid", "returned_at"])
          .where("id", "=", id)
          .executeTakeFirstOrThrow();

      expect(await markEmailRelocated(trx, a.ctx, id, { ...change, from: "Rachunki" })).toBe(false);
      expect(await markEmailRelocated(trx, b.ctx, id, change)).toBe(false);
      let row = await read();
      expect({ folder: row.folder, source: row.source_folder, uid: Number(row.uid) }).toEqual({
        folder: "INBOX",
        source: "INBOX",
        uid: 1,
      });

      expect(await markEmailRelocated(trx, a.ctx, id, change)).toBe(true);
      row = await read();
      expect({ ...row, uid: Number(row.uid), source_uid: Number(row.source_uid) }).toEqual({
        folder: "Oferty",
        source_folder: "Oferty",
        uid: 80,
        source_uid: 80,
        returned_at: null,
      });
    });
  });

  test("markEmailRelocated leaves a system-moved row alone", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId, { folder: "AI/Info" }));
      const { id } = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      expect(await markEmailRelocated(trx, a.ctx, id, { from: "AI/Info", to: "Oferty", uid: 80 })).toBe(false);
    });
  });

  test("markEmailReturned with `from` changes the row only while it has that folder and UID", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId, { folder: "AI/Info" }));
      const { id } = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      const at = new Date("2026-11-03T13:00:00Z");
      const read = () =>
        trx
          .selectFrom("emails")
          .select(["folder", "source_folder", "uid", "source_uid", "returned_at"])
          .where("id", "=", id)
          .executeTakeFirstOrThrow();

      expect(
        await markEmailReturned(trx, a.ctx, id, 60, at, { folder: "Oferty", from: { folder: "AI/Info", uid: 2 } })
      ).toBe(false);
      expect(
        await markEmailReturned(trx, a.ctx, id, 60, at, { folder: "Oferty", from: { folder: "AI/Spam", uid: 1 } })
      ).toBe(false);
      let row = await read();
      expect({
        folder: row.folder,
        source: row.source_folder,
        uid: Number(row.uid),
        returnedAt: row.returned_at,
      }).toEqual({
        folder: "AI/Info",
        source: "INBOX",
        uid: 1,
        returnedAt: null,
      });

      expect(
        await markEmailReturned(trx, a.ctx, id, 60, at, { folder: "Oferty", from: { folder: "AI/Info", uid: 1 } })
      ).toBe(true);
      row = await read();
      expect({ ...row, uid: Number(row.uid), source_uid: Number(row.source_uid) }).toEqual({
        folder: "Oferty",
        source_folder: "Oferty",
        uid: 60,
        source_uid: 60,
        returned_at: at,
      });
    });
  });

  test("markEmailRelocated with `fromUid` changes the row only while it has that UID", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId));
      const { id } = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      const change = { from: "INBOX", to: "Oferty", uid: 80 };

      expect(await markEmailRelocated(trx, a.ctx, id, { ...change, fromUid: 9 })).toBe(false);
      expect(Number((await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1")).uid)).toBe(1);

      expect(await markEmailRelocated(trx, a.ctx, id, { ...change, fromUid: 1 })).toBe(true);
      const row = await trx
        .selectFrom("emails")
        .select(["folder", "source_folder", "uid", "source_uid", "returned_at"])
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect({ ...row, uid: Number(row.uid), source_uid: Number(row.source_uid) }).toEqual({
        folder: "Oferty",
        source_folder: "Oferty",
        uid: 80,
        source_uid: 80,
        returned_at: null,
      });
    });
  });
});
