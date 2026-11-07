import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { getMailboxSettings, insertDefaultSettings } from "../../src/modules/config";
import type { NewEmail } from "../../src/modules/mail";
import {
  findCopies,
  forceRescan,
  getCredentials,
  getMailbox,
  insertCredentials,
  insertEmail,
  insertMailbox,
  listFolderUids,
  listInboxEmailKeys,
  listRecentlyMoved,
  listSyncTargets,
  lockMailbox,
  markEmailReturned,
  markSynced,
  setMailboxStatus,
  updateCursor,
  updateEmailUid,
} from "../../src/modules/mail/repo";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

interface Tenant {
  ctx: TenantContext;
  mailboxId: string;
}

async function createTwoTenants(trx: Transaction<DB>): Promise<{ a: Tenant; b: Tenant }> {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  return {
    a: { ctx: { orgId: a.orgId }, mailboxId: a.mailboxId },
    b: { ctx: { orgId: b.orgId }, mailboxId: b.mailboxId },
  };
}

function newEmail(mailboxId: string, overrides: Partial<NewEmail> = {}): NewEmail {
  return {
    mailbox_id: mailboxId,
    dedup_key: "mid:<1@x.test>:hash-1",
    message_id_header: "<1@x.test>",
    content_hash: "hash-1",
    uid: 1,
    thread_key: "<1@x.test>",
    from_address: "sender@x.test",
    subject: "Hello",
    received_at: new Date("2026-11-03T10:00:00Z"),
    ...overrides,
  };
}

async function inboxUidOf(trx: Transaction<DB>, emailId: string) {
  const row = await trx.selectFrom("emails").select("inbox_uid").where("id", "=", emailId).executeTakeFirstOrThrow();
  return row.inbox_uid;
}

async function emailRow(trx: Transaction<DB>, mailboxId: string, dedupKey: string) {
  return trx
    .selectFrom("emails")
    .select(["id", "org_id", "uid", "folder", "returned_at", "status"])
    .where("mailbox_id", "=", mailboxId)
    .where("dedup_key", "=", dedupKey)
    .executeTakeFirstOrThrow();
}

describe("mail repository: mailboxes", () => {
  test("insertMailbox stores the org_id of the context and getMailbox converts the cursor", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const row = await getMailbox(trx, a.ctx, a.mailboxId);
      expect(row?.org_id).toBe(a.ctx.orgId);
      expect(row?.uidvalidity).toBeNull();
      expect(row?.last_uid).toBeNull();
      expect(row?.capabilities).toEqual(testCapabilities);
      expect(row?.folder_map).toEqual({ drafts: "Drafts" });
      expect(row?.status).toBe("active");
      expect(await getMailbox(trx, b.ctx, a.mailboxId)).toBeUndefined();

      const id = randomUUID();
      await insertMailbox(trx, b.ctx, {
        id,
        address: "second@x.test",
        imapHost: "imap.x.test",
        imapPort: 993,
        smtpHost: "smtp.x.test",
        smtpPort: 465,
        capabilities: testCapabilities,
        folderMap: {},
      });
      expect((await getMailbox(trx, b.ctx, id))?.org_id).toBe(b.ctx.orgId);
      expect(await getMailbox(trx, a.ctx, id)).toBeUndefined();
    });
  });

  test("lockMailbox returns the row only for the owner's context", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      expect((await lockMailbox(trx, a.ctx, a.mailboxId))?.id).toBe(a.mailboxId);
      expect(await lockMailbox(trx, b.ctx, a.mailboxId)).toBeUndefined();
    });
  });

  test("updateCursor changes the cursor only with the right context and the right expected value", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const empty = { uidValidity: null, lastUid: null };
      const first = { uidValidity: 4_000_000_000, lastUid: 10 };

      expect(await updateCursor(trx, b.ctx, a.mailboxId, empty, first)).toBe(false);
      let row = await getMailbox(trx, a.ctx, a.mailboxId);
      expect({ uidValidity: row?.uidvalidity, lastUid: row?.last_uid }).toEqual(empty);

      expect(await updateCursor(trx, a.ctx, a.mailboxId, empty, first)).toBe(true);
      row = await getMailbox(trx, a.ctx, a.mailboxId);
      expect({ uidValidity: row?.uidvalidity, lastUid: row?.last_uid }).toEqual(first);

      expect(await updateCursor(trx, a.ctx, a.mailboxId, empty, { uidValidity: 1, lastUid: 1 })).toBe(false);
      expect(
        await updateCursor(
          trx,
          a.ctx,
          a.mailboxId,
          { uidValidity: 4_000_000_000, lastUid: 9 },
          { uidValidity: 1, lastUid: 1 }
        )
      ).toBe(false);
      row = await getMailbox(trx, a.ctx, a.mailboxId);
      expect({ uidValidity: row?.uidvalidity, lastUid: row?.last_uid }).toEqual(first);

      expect(await updateCursor(trx, a.ctx, a.mailboxId, first, { uidValidity: 4_000_000_000, lastUid: 12 })).toBe(
        true
      );
      row = await getMailbox(trx, a.ctx, a.mailboxId);
      expect(row?.last_uid).toBe(12);
    });
  });

  test("markSynced and setMailboxStatus change 0 rows of another organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const at = new Date("2026-11-03T12:00:00Z");

      await markSynced(trx, b.ctx, a.mailboxId, at);
      await setMailboxStatus(trx, b.ctx, a.mailboxId, "paused");
      let row = await getMailbox(trx, a.ctx, a.mailboxId);
      expect(row?.last_synced_at).toBeNull();
      expect(row?.status).toBe("active");

      await markSynced(trx, a.ctx, a.mailboxId, at);
      await setMailboxStatus(trx, a.ctx, a.mailboxId, "auth_error");
      row = await getMailbox(trx, a.ctx, a.mailboxId);
      expect(row?.last_synced_at).toEqual(at);
      expect(row?.status).toBe("auth_error");
    });
  });

  test("listSyncTargets lists the active mailboxes of all organizations and not a paused one", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const paused = await createOrgWithMailbox(trx);
      await setMailboxStatus(trx, { orgId: paused.orgId }, paused.mailboxId, "paused");

      const targets = await listSyncTargets(trx);
      expect(targets).toContainEqual({ orgId: a.ctx.orgId, mailboxId: a.mailboxId });
      expect(targets).toContainEqual({ orgId: b.ctx.orgId, mailboxId: b.mailboxId });
      expect(targets.map((t) => t.mailboxId)).not.toContain(paused.mailboxId);
    });
  });
});

describe("mail repository: forceRescan", () => {
  test("sets uidvalidity to 0 only for the owner, and not on a never-synced mailbox", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);

      expect(await forceRescan(trx, a.ctx, a.mailboxId)).toBe(false);

      await updateCursor(trx, a.ctx, a.mailboxId, { uidValidity: null, lastUid: null }, { uidValidity: 7, lastUid: 5 });
      expect(await forceRescan(trx, b.ctx, a.mailboxId)).toBe(false);
      expect((await getMailbox(trx, a.ctx, a.mailboxId))?.uidvalidity).toBe(7);

      expect(await forceRescan(trx, a.ctx, a.mailboxId)).toBe(true);
      const row = await getMailbox(trx, a.ctx, a.mailboxId);
      expect({ uidValidity: row?.uidvalidity, lastUid: row?.last_uid }).toEqual({ uidValidity: 0, lastUid: 5 });
    });
  });
});

describe("mail repository: credentials", () => {
  test("getCredentials returns the row only for the owner's context", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertCredentials(trx, a.ctx, {
        mailboxId: a.mailboxId,
        encryptedSecret: "ciphertext",
        secretKind: "app_password",
        keyVersion: 1,
      });
      expect(await getCredentials(trx, a.ctx, a.mailboxId)).toEqual({
        encrypted_secret: "ciphertext",
        secret_kind: "app_password",
        key_version: 1,
      });
      expect(await getCredentials(trx, b.ctx, a.mailboxId)).toBeUndefined();
    });
  });

  test("insertCredentials with the context of B and the mailbox of A fails with 23503", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await sql`savepoint cross_org_credentials`.execute(trx);
      await expect(
        insertCredentials(trx, b.ctx, {
          mailboxId: a.mailboxId,
          encryptedSecret: "ciphertext",
          secretKind: "password",
          keyVersion: 1,
        })
      ).rejects.toMatchObject({ code: "23503" });
      await sql`rollback to savepoint cross_org_credentials`.execute(trx);
    });
  });
});

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

  test("insertEmail sets inbox_uid to uid", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId, { uid: 7 }));
      const row = await trx
        .selectFrom("emails")
        .select(["uid", "inbox_uid"])
        .where("mailbox_id", "=", a.mailboxId)
        .executeTakeFirstOrThrow();
      expect({ uid: Number(row.uid), inboxUid: Number(row.inbox_uid) }).toEqual({ uid: 7, inboxUid: 7 });
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

  test("listRecentlyMoved filters by org, mailbox, folder, inbox_uid and window, newest moved_at first, and limits", async () => {
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
        .set({ inbox_uid: null })
        .where("mailbox_id", "=", a.mailboxId)
        .where("dedup_key", "=", "mid:<3@x.test>:h")
        .execute();
      await add(a, 8, { folder: "AI/Info" }, at(7));

      const all = await listRecentlyMoved(trx, a.ctx, a.mailboxId, { movedAfter: at(6), limit: 10 });
      expect(all.map((row) => row.uid)).toEqual([2, 1, 8]);
      expect(all[0]).toMatchObject({ folder: "AI/Info", inbox_uid: 2, moved_at: at(10) });
      const limited = await listRecentlyMoved(trx, a.ctx, a.mailboxId, { movedAfter: at(6), limit: 2 });
      expect(limited.map((row) => row.uid)).toEqual([2, 1]);
      expect(await listRecentlyMoved(trx, b.ctx, a.mailboxId, { movedAfter: at(6), limit: 10 })).toEqual([]);
      expect(await listRecentlyMoved(trx, a.ctx, b.mailboxId, { movedAfter: at(6), limit: 10 })).toEqual([]);
    });
  });

  test("updateEmailUid changes 0 rows of another organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId));
      const { id } = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");

      await updateEmailUid(trx, b.ctx, id, 50);
      expect(Number((await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1")).uid)).toBe(1);

      await updateEmailUid(trx, a.ctx, id, 50);
      expect(Number((await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1")).uid)).toBe(50);
      expect(Number(await inboxUidOf(trx, id))).toBe(50);
    });
  });

  test("markEmailReturned sets returned_at, folder and uid, and changes 0 rows of another organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId, { folder: "AI/Info" }));
      const { id } = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      const at = new Date("2026-11-03T13:00:00Z");

      expect(await markEmailReturned(trx, b.ctx, id, 60, at)).toBe(false);
      let row = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      expect({ folder: row.folder, uid: Number(row.uid), returnedAt: row.returned_at }).toEqual({
        folder: "AI/Info",
        uid: 1,
        returnedAt: null,
      });

      expect(await markEmailReturned(trx, a.ctx, id, 60, at)).toBe(true);
      row = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      expect({ folder: row.folder, uid: Number(row.uid), returnedAt: row.returned_at, status: row.status }).toEqual({
        folder: "INBOX",
        uid: 60,
        returnedAt: at,
        status: "pending",
      });
      expect(Number(await inboxUidOf(trx, id))).toBe(60);

      // onlyOutsideInbox: a row that is already in INBOX stays as it is.
      const later = new Date("2026-11-03T14:00:00Z");
      expect(await markEmailReturned(trx, a.ctx, id, 70, later, { onlyOutsideInbox: true })).toBe(false);
      row = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      expect({ uid: Number(row.uid), returnedAt: row.returned_at }).toEqual({ uid: 60, returnedAt: at });
    });
  });
});

describe("mail repository: listInboxEmailKeys", () => {
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

      const rows = await listInboxEmailKeys(trx, a.ctx, a.mailboxId, since);
      expect(rows).toHaveLength(2);
      expect(rows).toEqual(
        expect.arrayContaining([
          { message_id_header: "<1@x.test>", content_hash: "hash-1" },
          { message_id_header: "<edge@x.test>", content_hash: "edge" },
        ])
      );
      expect(await listInboxEmailKeys(trx, b.ctx, a.mailboxId, since)).toEqual([]);
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
