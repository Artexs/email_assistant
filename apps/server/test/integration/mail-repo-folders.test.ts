import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { getMailboxSettings, insertDefaultSettings } from "../../src/modules/config";
import { INBOX } from "../../src/modules/mail";
import {
  getMailbox,
  getJunkFolderPath,
  getSyncFolder,
  insertEmail,
  insertSyncFolders,
  insertMailbox,
  listEmailsByMessageIds,
  listFolderRowsAtUids,
  listFolderEmailKeys,
  listMoveCandidates,
  listSyncFolders,
  lockSyncFolderByKey,
  setFolderMapEntry,
  updateEmailLocation,
  updateFolderCursor,
  updateSyncFolderEnabled,
} from "../../src/modules/mail/repo";
import type { DB } from "../../src/platform/db";
import { HardError } from "../../src/platform/errors";

import { testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { createTwoTenants, emailRow, newEmail } from "./mail-repo-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("mail repository: listMoveCandidates", () => {
  test("returns the rows of the ids in the mailbox with all fields, and leaves out other orgs and unknown mailboxes", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertEmail(
        trx,
        a.ctx,
        newEmail(a.mailboxId, { dedup_key: "mid:<1@x.test>:hash-1", folder: "AI/Info", uid: 7 })
      );
      await insertEmail(
        trx,
        a.ctx,
        newEmail(a.mailboxId, {
          dedup_key: "mid:<2@x.test>:hash-2",
          message_id_header: null,
          content_hash: "hash-2",
          uid: 8,
          from_address: null,
        })
      );
      await insertEmail(trx, b.ctx, newEmail(b.mailboxId));
      const idA1 = (await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1")).id;
      const idA2 = (await emailRow(trx, a.mailboxId, "mid:<2@x.test>:hash-2")).id;
      const idB = (await emailRow(trx, b.mailboxId, "mid:<1@x.test>:hash-1")).id;

      const rows = await listMoveCandidates(trx, a.ctx, a.mailboxId, [idA1, idA2, idB]);
      expect(rows.sort((x, y) => x.uid - y.uid)).toEqual([
        {
          id: idA1,
          folder: "AI/Info",
          source_folder: "INBOX",
          uid: 7,
          message_id_header: "<1@x.test>",
          content_hash: "hash-1",
          from_address: "sender@x.test",
          received_at: new Date("2026-11-03T10:00:00Z"),
          move_pending_at: null,
        },
        {
          id: idA2,
          folder: "INBOX",
          source_folder: "INBOX",
          uid: 8,
          message_id_header: null,
          content_hash: "hash-2",
          from_address: null,
          received_at: new Date("2026-11-03T10:00:00Z"),
          move_pending_at: null,
        },
      ]);
      expect(await listMoveCandidates(trx, b.ctx, a.mailboxId, [idA1, idA2, idB])).toEqual([]);
      expect(await listMoveCandidates(trx, a.ctx, randomUUID(), [idA1])).toEqual([]);
    });
  });

  test("returns [] for an empty id list", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      expect(await listMoveCandidates(trx, a.ctx, a.mailboxId, [])).toEqual([]);
    });
  });
});

describe("mail repository: listFolderEmailKeys", () => {
  test("lists INBOX rows since the time, and filters by org_id", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const since = new Date("2026-11-03T09:00:00Z");
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId));
      await insertEmail(
        trx,
        a.ctx,
        newEmail(a.mailboxId, {
          dedup_key: "hash:old",
          content_hash: "old",
          received_at: new Date("2026-11-03T08:00:00Z"),
        })
      );
      await insertEmail(
        trx,
        a.ctx,
        newEmail(a.mailboxId, { dedup_key: "hash:moved", content_hash: "moved", folder: "AI/Info" })
      );

      await insertEmail(
        trx,
        a.ctx,
        newEmail(a.mailboxId, {
          dedup_key: "hash:edge",
          message_id_header: "<edge@x.test>",
          content_hash: "edge",
          received_at: since,
        })
      );
      const otherMailboxId = randomUUID();
      await insertMailbox(trx, a.ctx, {
        id: otherMailboxId,
        address: `other-${otherMailboxId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await insertEmail(
        trx,
        a.ctx,
        newEmail(otherMailboxId, {
          dedup_key: "hash:other",
          message_id_header: "<other@x.test>",
          content_hash: "other",
        })
      );

      const rows = await listFolderEmailKeys(trx, a.ctx, a.mailboxId, ["INBOX"], since);
      expect(rows).toHaveLength(2);
      expect(rows).toEqual(
        expect.arrayContaining([
          { message_id_header: "<1@x.test>", content_hash: "hash-1" },
          { message_id_header: "<edge@x.test>", content_hash: "edge" },
        ])
      );
      expect(await listFolderEmailKeys(trx, b.ctx, a.mailboxId, ["INBOX"], since)).toEqual([]);
      expect(await listFolderEmailKeys(trx, a.ctx, a.mailboxId, [], since)).toEqual([]);
      const several = await listFolderEmailKeys(trx, a.ctx, a.mailboxId, ["INBOX", "AI/Info"], since);
      expect(several.map((row) => row.content_hash).sort()).toEqual(["edge", "hash-1", "moved"]);
    });
  });
});

describe("config repository: mailbox settings", () => {
  test("getMailboxSettings after insertDefaultSettings gives shadow mode and empty switches and policy", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertDefaultSettings(trx, a.ctx, a.mailboxId);
      const settings = await getMailboxSettings(trx, a.ctx, a.mailboxId);
      expect(settings?.org_id).toBe(a.ctx.orgId);
      expect(settings?.mode).toBe("shadow");
      expect(settings?.tool_switches).toEqual({});
      expect(settings?.category_policy).toEqual({});
      expect(await getMailboxSettings(trx, b.ctx, a.mailboxId)).toBeUndefined();
    });
  });

  test("insertDefaultSettings with the context of B and the mailbox of A fails with 23503", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await sql`savepoint cross_org_settings`.execute(trx);
      await expect(insertDefaultSettings(trx, b.ctx, a.mailboxId)).rejects.toMatchObject({ code: "23503" });
      await sql`rollback to savepoint cross_org_settings`.execute(trx);
    });
  });
});

describe("mail repository: email location", () => {
  async function locationOf(trx: Transaction<DB>, emailId: string) {
    return trx
      .selectFrom("emails")
      .select(["folder", "uid", "source_uid", "moved_at", "status", "returned_at"])
      .where("id", "=", emailId)
      .executeTakeFirstOrThrow();
  }

  test("updateEmailLocation changes only the named columns and filters by org_id", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId));
      const { id } = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      const movedAt = new Date("2026-11-04T10:00:00Z");

      expect(await updateEmailLocation(trx, a.ctx, id, { folder: "AI/Info", uid: 77, movedAt })).toBe(true);
      const moved = await locationOf(trx, id);
      expect(moved.folder).toBe("AI/Info");
      expect(Number(moved.uid)).toBe(77);
      expect(Number(moved.source_uid)).toBe(1);
      expect(moved.moved_at?.toISOString()).toBe(movedAt.toISOString());
      expect(moved.returned_at).toBeNull();

      // undefined keeps source_uid and moved_at
      await updateEmailLocation(trx, a.ctx, id, { folder: "AI/Info", uid: 78 });
      const kept = await locationOf(trx, id);
      expect(Number(kept.uid)).toBe(78);
      expect(Number(kept.source_uid)).toBe(1);
      expect(kept.moved_at?.toISOString()).toBe(movedAt.toISOString());

      // org B cannot change it
      expect(await updateEmailLocation(trx, b.ctx, id, { folder: "X", uid: 1 })).toBe(false);
      expect((await locationOf(trx, id)).folder).toBe("AI/Info");

      // movedAt null clears; sourceUid is set when given
      await updateEmailLocation(trx, a.ctx, id, { folder: INBOX, uid: 5, sourceUid: 5, movedAt: null });
      const back = await locationOf(trx, id);
      expect(back.folder).toBe(INBOX);
      expect(Number(back.source_uid)).toBe(5);
      expect(back.moved_at).toBeNull();
      expect(back.status).toBe("pending");
    });
  });

  test("setFolderMapEntry replaces one key, keeps the others and filters by org_id", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      expect(await setFolderMapEntry(trx, a.ctx, a.mailboxId, "ai_info", "INBOX.AI.Info")).toBe(true);
      expect((await getMailbox(trx, a.ctx, a.mailboxId))?.folder_map).toEqual({
        drafts: "Drafts",
        ai_info: "INBOX.AI.Info",
      });
      await setFolderMapEntry(trx, a.ctx, a.mailboxId, "ai_info", "AI/Info");
      await setFolderMapEntry(trx, a.ctx, a.mailboxId, "ai_spam", "Junk2");
      expect((await getMailbox(trx, a.ctx, a.mailboxId))?.folder_map).toEqual({
        drafts: "Drafts",
        ai_spam: "Junk2",
        ai_info: "AI/Info",
      });
      expect(await setFolderMapEntry(trx, b.ctx, a.mailboxId, "ai_info", "Nope")).toBe(false);
    });
  });

  test("listEmailsByMessageIds returns the rows of the given ids and filters by org_id", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      for (const [index, id] of ["<a1@x.test>", "<a2@x.test>", "<a3@x.test>"].entries()) {
        await insertEmail(
          trx,
          a.ctx,
          newEmail(a.mailboxId, { dedup_key: `k${index}`, message_id_header: id, content_hash: `h${index}` })
        );
      }
      await insertEmail(
        trx,
        b.ctx,
        newEmail(b.mailboxId, { dedup_key: "kb", message_id_header: "<a1@x.test>", content_hash: "hb" })
      );

      const rows = await listEmailsByMessageIds(trx, a.ctx, a.mailboxId, ["<a1@x.test>", "<a2@x.test>"]);
      expect(rows.map((row) => row.message_id_header).sort()).toEqual(["<a1@x.test>", "<a2@x.test>"]);
      expect(rows[0]?.folder).toBe(INBOX);
      expect(await listEmailsByMessageIds(trx, b.ctx, a.mailboxId, ["<a1@x.test>"])).toEqual([]);
      expect(await listEmailsByMessageIds(trx, a.ctx, a.mailboxId, [])).toEqual([]);
    });
  });
});

describe("mail repository: sync folders", () => {
  const offers = { key: "offers", path: "Oferty", role: "sort" } as const;
  const junk = { key: "junk", path: "Wiadomości-śmieci", role: "junk" } as const;
  const at = new Date("2026-11-01T10:00:00.000Z");

  test("listSyncFolders of a new mailbox is the INBOX row, tenant-scoped", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const rows = await listSyncFolders(trx, a.ctx, a.mailboxId, { enabledOnly: false });
      expect(rows.map((row) => [row.key, row.role, row.path])).toEqual([["inbox", "inbox", INBOX]]);
      expect(await listSyncFolders(trx, b.ctx, a.mailboxId, { enabledOnly: false })).toEqual([]);
    });
  });

  test("listSyncFolders orders inbox, sort rows in default order, junk; enabledOnly leaves disabled out", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const bills = { key: "bills", path: "Rachunki", role: "sort" } as const;
      await insertSyncFolders(trx, a.ctx, a.mailboxId, [junk, bills, offers], at);
      await trx
        .updateTable("mailbox_folders")
        .set({ enabled: false })
        .where("mailbox_id", "=", a.mailboxId)
        .where("key", "=", "bills")
        .execute();
      const all = await listSyncFolders(trx, a.ctx, a.mailboxId, { enabledOnly: false });
      expect(all.map((row) => row.key)).toEqual(["inbox", "offers", "bills", "junk"]);
      const enabled = await listSyncFolders(trx, a.ctx, a.mailboxId, { enabledOnly: true });
      expect(enabled.map((row) => row.key)).toEqual(["inbox", "offers", "junk"]);
    });
  });

  test("insertSyncFolders returns only new rows and never changes an existing row", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      expect(await insertSyncFolders(trx, a.ctx, a.mailboxId, [], at)).toEqual([]);
      expect(await insertSyncFolders(trx, a.ctx, a.mailboxId, [offers], at)).toEqual([{ key: "offers", role: "sort" }]);
      expect(await insertSyncFolders(trx, a.ctx, a.mailboxId, [{ ...offers, path: "Other" }], at)).toEqual([]);
      expect((await getSyncFolder(trx, a.ctx, a.mailboxId, "offers"))?.path).toBe("Oferty");
    });
  });

  test("insertSyncFolders with another organization's context is refused by the foreign key", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      // A savepoint keeps the failed insert from aborting the shared test transaction.
      await sql`savepoint foreign_insert`.execute(trx);
      await expect(insertSyncFolders(trx, b.ctx, a.mailboxId, [offers], at)).rejects.toThrow(/foreign key/);
      await sql`rollback to savepoint foreign_insert`.execute(trx);
      expect(await getSyncFolder(trx, a.ctx, a.mailboxId, "offers")).toBeUndefined();
    });
  });

  test("lockSyncFolderByKey is tenant-scoped", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      expect((await lockSyncFolderByKey(trx, a.ctx, a.mailboxId, "inbox"))?.key).toBe("inbox");
      expect(await lockSyncFolderByKey(trx, b.ctx, a.mailboxId, "inbox")).toBeUndefined();
      expect(await lockSyncFolderByKey(trx, a.ctx, a.mailboxId, "offers")).toBeUndefined();
    });
  });

  test("getJunkFolderPath is null before, the path after (also disabled), null for another tenant", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      expect(await getJunkFolderPath(trx, a.ctx, a.mailboxId)).toBeNull();
      await insertSyncFolders(trx, a.ctx, a.mailboxId, [junk], at);
      expect(await getJunkFolderPath(trx, a.ctx, a.mailboxId)).toBe("Wiadomości-śmieci");
      await trx.updateTable("mailbox_folders").set({ enabled: false }).where("key", "=", "junk").execute();
      expect(await getJunkFolderPath(trx, a.ctx, a.mailboxId)).toBe("Wiadomości-śmieci");
      expect(await getJunkFolderPath(trx, b.ctx, a.mailboxId)).toBeNull();
    });
  });

  test("updateSyncFolderEnabled with another organization's context changes nothing", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertSyncFolders(trx, a.ctx, a.mailboxId, [offers], at);
      const row = await getSyncFolder(trx, a.ctx, a.mailboxId, "offers");
      if (!row) throw new Error("folder row missing");
      await updateFolderCursor(
        trx,
        a.ctx,
        row.id,
        { uidValidity: null, lastUid: null },
        { uidValidity: 1, lastUid: 500 }
      );

      expect(await updateSyncFolderEnabled(trx, b.ctx, row.id, { enabled: false, clearCursor: true, at })).toBe(false);
      const after = await getSyncFolder(trx, a.ctx, a.mailboxId, "offers");
      expect({ enabled: after?.enabled, uv: after?.uidvalidity, last: after?.last_uid }).toEqual({
        enabled: true,
        uv: 1,
        last: 500,
      });
    });
  });

  test("listSyncFolders throws a HardError for a key that the database allows and the enum does not", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await trx
        .insertInto("mailbox_folders")
        .values({ org_id: a.ctx.orgId, mailbox_id: a.mailboxId, key: "junk_b", path: "X", role: "sort" })
        .execute();
      await expect(listSyncFolders(trx, a.ctx, a.mailboxId, { enabledOnly: false })).rejects.toBeInstanceOf(HardError);
    });
  });
});

describe("mail repository: listFolderRowsAtUids", () => {
  test("returns the rows that hold one of the UIDs in the folder, with their identity fields", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId, { dedup_key: "mid:<1@x.test>:hash-1", uid: 10 }));
      await insertEmail(
        trx,
        a.ctx,
        newEmail(a.mailboxId, { dedup_key: "mid:<2@x.test>:hash-2", message_id_header: "<2@x.test>", uid: 12 })
      );
      await insertEmail(
        trx,
        a.ctx,
        newEmail(a.mailboxId, { dedup_key: "mid:<1@x.test>:hash-1#2", folder: "Oferty", uid: 10 })
      );
      const idA = (await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1")).id;

      expect(await listFolderRowsAtUids(trx, a.ctx, a.mailboxId, "INBOX", [10, 11])).toEqual([
        {
          id: idA,
          uid: 10,
          message_id_header: "<1@x.test>",
          content_hash: "hash-1",
          from_address: "sender@x.test",
          received_at: new Date("2026-11-03T10:00:00Z"),
        },
      ]);
    });
  });

  test("returns [] for an empty UID list", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId, { uid: 10 }));
      expect(await listFolderRowsAtUids(trx, a.ctx, a.mailboxId, "INBOX", [])).toEqual([]);
    });
  });

  test("leaves out the rows of another mailbox of the same org", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const otherMailboxId = randomUUID();
      await insertMailbox(trx, a.ctx, {
        id: otherMailboxId,
        address: `other-${otherMailboxId}@x.test`,
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      await insertEmail(trx, a.ctx, newEmail(otherMailboxId, { uid: 10 }));
      expect(await listFolderRowsAtUids(trx, a.ctx, a.mailboxId, "INBOX", [10])).toEqual([]);
      expect(await listFolderRowsAtUids(trx, a.ctx, otherMailboxId, "INBOX", [10])).toHaveLength(1);
    });
  });

  test("leaves out the rows of another org", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertEmail(trx, b.ctx, newEmail(b.mailboxId, { uid: 10 }));
      expect(await listFolderRowsAtUids(trx, a.ctx, b.mailboxId, "INBOX", [10])).toEqual([]);
      expect(await listFolderRowsAtUids(trx, b.ctx, b.mailboxId, "INBOX", [10])).toHaveLength(1);
    });
  });
});
