import { randomUUID } from "node:crypto";

import { mailboxStatuses } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import {
  forceRescan,
  getCredentials,
  getMailbox,
  getMailboxSummary,
  getSyncFolder,
  insertCredentials,
  insertInboxFolder,
  insertMailbox,
  listSyncTargets,
  lockMailbox,
  markSynced,
  setMailboxStatus,
  updateCursor,
  updateFolderCursor,
} from "../../src/modules/mail/repo";

import { createOrgWithMailbox, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { createTwoTenants } from "./mail-repo-helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("mail repository: mailboxes", () => {
  test("insertMailbox stores the org_id of the context and getMailbox returns the row", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const row = await getMailbox(trx, a.ctx, a.mailboxId);
      expect(row?.org_id).toBe(a.ctx.orgId);
      // The old copy of the INBOX cursor stays out of the row: the cursor is read from `mailbox_folders`.
      expect(row).not.toHaveProperty("uidvalidity");
      expect(row).not.toHaveProperty("last_uid");
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
      let row = await getSyncFolder(trx, a.ctx, a.mailboxId, "inbox");
      expect({ uidValidity: row?.uidvalidity, lastUid: row?.last_uid }).toEqual(empty);

      expect(await updateCursor(trx, a.ctx, a.mailboxId, empty, first)).toBe(true);
      row = await getSyncFolder(trx, a.ctx, a.mailboxId, "inbox");
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
      row = await getSyncFolder(trx, a.ctx, a.mailboxId, "inbox");
      expect({ uidValidity: row?.uidvalidity, lastUid: row?.last_uid }).toEqual(first);

      expect(await updateCursor(trx, a.ctx, a.mailboxId, first, { uidValidity: 4_000_000_000, lastUid: 12 })).toBe(
        true
      );
      row = await getSyncFolder(trx, a.ctx, a.mailboxId, "inbox");
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

describe("mail repository: mailbox status", () => {
  test("the status CHECK lists the statuses of core; host_blocked is accepted and a free word is not", async () => {
    await withRollback(db, async (trx) => {
      const result = await sql<{ def: string }>`
        select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'mailboxes'::regclass and conname = 'mailboxes_status_check'`.execute(trx);
      const values = [...(result.rows[0]?.def.matchAll(/'([a-z_]+)'/g) ?? [])].map((m) => m[1]).sort();
      expect(values).toEqual([...mailboxStatuses].sort());

      const { a } = await createTwoTenants(trx);
      await trx.updateTable("mailboxes").set({ status: "host_blocked" }).where("id", "=", a.mailboxId).execute();
      expect((await getMailboxSummary(trx, a.ctx, a.mailboxId))?.status).toBe("host_blocked");

      await sql`savepoint frozen`.execute(trx);
      await expect(
        trx.updateTable("mailboxes").set({ status: "frozen" }).where("id", "=", a.mailboxId).execute()
      ).rejects.toMatchObject({ code: "23514" });
      await sql`rollback to savepoint frozen`.execute(trx);
    });
  });
});

describe("mail repository: sync folder cursor", () => {
  test("insertInboxFolder twice leaves one row; getSyncFolder is tenant-scoped", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertInboxFolder(trx, a.ctx, a.mailboxId);
      const rows = await trx.selectFrom("mailbox_folders").select("id").where("mailbox_id", "=", a.mailboxId).execute();
      expect(rows).toHaveLength(1);

      const folder = await getSyncFolder(trx, a.ctx, a.mailboxId, "inbox");
      expect(folder).toMatchObject({
        id: rows[0]?.id,
        key: "inbox",
        path: "INBOX",
        role: "inbox",
        enabled: true,
        uidvalidity: null,
        last_uid: null,
      });
      expect(await getSyncFolder(trx, b.ctx, a.mailboxId, "inbox")).toBeUndefined();
      expect(await getSyncFolder(trx, a.ctx, a.mailboxId, "offers")).toBeUndefined();
    });
  });

  test("updateFolderCursor on the INBOX row compares the cursor", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      const folder = await getSyncFolder(trx, a.ctx, a.mailboxId, "inbox");
      if (folder === undefined) throw new Error("no INBOX row");
      const empty = { uidValidity: null, lastUid: null };
      const first = { uidValidity: 4_000_000_000, lastUid: 10 };

      expect(await updateFolderCursor(trx, b.ctx, folder.id, empty, first)).toBe(false);
      expect(await updateFolderCursor(trx, a.ctx, folder.id, { uidValidity: 1, lastUid: 1 }, first)).toBe(false);
      expect((await getSyncFolder(trx, a.ctx, a.mailboxId, "inbox"))?.last_uid).toBeNull();

      expect(await updateFolderCursor(trx, a.ctx, folder.id, empty, first)).toBe(true);
      const row = await getSyncFolder(trx, a.ctx, a.mailboxId, "inbox");
      expect({ uidValidity: row?.uidvalidity, lastUid: row?.last_uid }).toEqual(first);
    });
  });

  test("updateFolderCursor on a non-INBOX row writes that row", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const inserted = await trx
        .insertInto("mailbox_folders")
        .values({ org_id: a.ctx.orgId, mailbox_id: a.mailboxId, key: "offers", path: "Oferty", role: "sort" })
        .returning("id")
        .executeTakeFirstOrThrow();
      const next = { uidValidity: 9, lastUid: 33 };

      expect(await updateFolderCursor(trx, a.ctx, inserted.id, { uidValidity: null, lastUid: null }, next)).toBe(true);
      const row = await getSyncFolder(trx, a.ctx, a.mailboxId, "offers");
      expect({ uidValidity: row?.uidvalidity, lastUid: row?.last_uid }).toEqual(next);
    });
  });
});

describe("mail repository: forceRescan", () => {
  test("sets uidvalidity to 0 only for the owner, and not on a never-synced mailbox", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);

      expect(await forceRescan(trx, a.ctx, a.mailboxId)).toBe(false);

      await updateCursor(trx, a.ctx, a.mailboxId, { uidValidity: null, lastUid: null }, { uidValidity: 7, lastUid: 5 });
      const sort = await trx
        .insertInto("mailbox_folders")
        .values({
          org_id: a.ctx.orgId,
          mailbox_id: a.mailboxId,
          key: "offers",
          path: "Oferty",
          role: "sort",
          uidvalidity: 4,
          last_uid: 8,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("mailbox_folders")
        .values({ org_id: a.ctx.orgId, mailbox_id: a.mailboxId, key: "bills", path: "Rachunki", role: "sort" })
        .execute();
      expect(await forceRescan(trx, b.ctx, a.mailboxId)).toBe(false);
      expect((await getSyncFolder(trx, a.ctx, a.mailboxId, "inbox"))?.uidvalidity).toBe(7);

      expect(await forceRescan(trx, a.ctx, a.mailboxId)).toBe(true);
      const folder = await getSyncFolder(trx, a.ctx, a.mailboxId, "inbox");
      expect({ uidValidity: folder?.uidvalidity, lastUid: folder?.last_uid }).toEqual({ uidValidity: 0, lastUid: 5 });
      const sortRow = await getSyncFolder(trx, a.ctx, a.mailboxId, "offers");
      expect({ id: sortRow?.id, uidValidity: sortRow?.uidvalidity, lastUid: sortRow?.last_uid }).toEqual({
        id: sort.id,
        uidValidity: 0,
        lastUid: 8,
      });
      const empty = await getSyncFolder(trx, a.ctx, a.mailboxId, "bills");
      expect({ uidValidity: empty?.uidvalidity, lastUid: empty?.last_uid }).toEqual({
        uidValidity: null,
        lastUid: null,
      });
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
