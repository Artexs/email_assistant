import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { getMailboxSettings, insertDefaultSettings } from "../../src/modules/config";
import type { NewEmail } from "../../src/modules/mail";
import {
  findCopies,
  getCredentials,
  getMailbox,
  insertCredentials,
  insertEmail,
  insertMailbox,
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

  test("updateEmailUid changes 0 rows of another organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId));
      const { id } = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");

      await updateEmailUid(trx, b.ctx, id, 50);
      expect(Number((await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1")).uid)).toBe(1);

      await updateEmailUid(trx, a.ctx, id, 50);
      expect(Number((await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1")).uid)).toBe(50);
    });
  });

  test("markEmailReturned sets returned_at, folder and uid, and changes 0 rows of another organization", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await insertEmail(trx, a.ctx, newEmail(a.mailboxId, { folder: "AI/Info" }));
      const { id } = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      const at = new Date("2026-11-03T13:00:00Z");

      await markEmailReturned(trx, b.ctx, id, 60, at);
      let row = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      expect({ folder: row.folder, uid: Number(row.uid), returnedAt: row.returned_at }).toEqual({
        folder: "AI/Info",
        uid: 1,
        returnedAt: null,
      });

      await markEmailReturned(trx, a.ctx, id, 60, at);
      row = await emailRow(trx, a.mailboxId, "mid:<1@x.test>:hash-1");
      expect({ folder: row.folder, uid: Number(row.uid), returnedAt: row.returned_at, status: row.status }).toEqual({
        folder: "INBOX",
        uid: 60,
        returnedAt: at,
        status: "pending",
      });
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
