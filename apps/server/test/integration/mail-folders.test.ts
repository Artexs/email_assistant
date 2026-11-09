import { afterAll, describe, expect, test } from "bun:test";
import type { Transaction } from "kysely";

import { ensureSyncFolders, setSyncFolderEnabled } from "../../src/modules/mail/folders";
import { getSyncFolder, listSyncFolders, updateFolderCursor } from "../../src/modules/mail/repo";
import type { DB, TenantContext } from "../../src/platform/db";
import { HardError } from "../../src/platform/errors";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
const at = new Date("2026-11-01T10:00:00.000Z");

afterAll(async () => {
  await db.destroy();
});

const offers = { key: "offers", path: "Oferty", role: "sort" } as const;
const social = { key: "social", path: "Społeczności", role: "sort" } as const;
const junk = { key: "junk", path: "Wiadomości-śmieci", role: "junk" } as const;

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

function folderId(row: { id: string } | undefined): string {
  if (!row) throw new Error("folder row missing");
  return row.id;
}

async function auditRows(trx: Transaction<DB>, orgId: string, event: string) {
  return trx
    .selectFrom("audit_log")
    .select(["actor", "data", "created_at"])
    .where("org_id", "=", orgId)
    .where("event", "=", event)
    .execute();
}

describe("ensureSyncFolders", () => {
  test("a plain Db writes the rows and the audit rows in its own transaction", async () => {
    const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    const ctx = { orgId: created.orgId };
    try {
      expect(await ensureSyncFolders(db, ctx, created.mailboxId, [offers, junk], at)).toEqual(["offers", "junk"]);
      const rows = await listSyncFolders(db, ctx, created.mailboxId, { enabledOnly: false });
      expect(rows.map((row) => row.key)).toEqual(["inbox", "offers", "junk"]);
      const audit = await db
        .selectFrom("audit_log")
        .select("data")
        .where("org_id", "=", ctx.orgId)
        .where("event", "=", "mailbox.sync_folder_added")
        .execute();
      expect(audit).toHaveLength(2);
      expect(await ensureSyncFolders(db, ctx, created.mailboxId, [offers, junk], at)).toEqual([]);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
    }
  });

  test("inserts the picks in order and audits key and role, never the path", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      expect(await ensureSyncFolders(trx, a.ctx, a.mailboxId, [offers, junk], at)).toEqual(["offers", "junk"]);
      const rows = await listSyncFolders(trx, a.ctx, a.mailboxId, { enabledOnly: false });
      expect(rows.map((row) => row.key)).toEqual(["inbox", "offers", "junk"]);
      const audit = await auditRows(trx, a.ctx.orgId, "mailbox.sync_folder_added");
      expect(audit).toHaveLength(2);
      const data = audit.map((row) => row.data);
      expect(data).toContainEqual({ mailbox_id: a.mailboxId, folder_key: "junk", role: "junk" });
      expect(data).toContainEqual({ mailbox_id: a.mailboxId, folder_key: "offers", role: "sort" });
    });
  });

  test("a second call returns only the new keys and audits only them", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await ensureSyncFolders(trx, a.ctx, a.mailboxId, [offers, junk], at);
      expect(await ensureSyncFolders(trx, a.ctx, a.mailboxId, [offers, social], at)).toEqual(["social"]);
      expect(await auditRows(trx, a.ctx.orgId, "mailbox.sync_folder_added")).toHaveLength(3);
    });
  });

  test("a disabled row stays disabled and keeps its cursor", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await ensureSyncFolders(trx, a.ctx, a.mailboxId, [offers], at);
      const row = await getSyncFolder(trx, a.ctx, a.mailboxId, "offers");
      await updateFolderCursor(
        trx,
        a.ctx,
        folderId(row),
        { uidValidity: null, lastUid: null },
        { uidValidity: 1, lastUid: 500 }
      );
      expect(await setSyncFolderEnabled(trx, a.ctx, a.mailboxId, "offers", false, "cli", at)).toBe("changed");

      expect(await ensureSyncFolders(trx, a.ctx, a.mailboxId, [offers], at)).toEqual([]);
      const after = await getSyncFolder(trx, a.ctx, a.mailboxId, "offers");
      expect({ enabled: after?.enabled, uv: after?.uidvalidity, last: after?.last_uid }).toEqual({
        enabled: false,
        uv: 1,
        last: 500,
      });
    });
  });

  test("a missing INBOX row is repaired without an audit row", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await trx.deleteFrom("mailbox_folders").where("mailbox_id", "=", a.mailboxId).execute();
      expect(await ensureSyncFolders(trx, a.ctx, a.mailboxId, [], at)).toEqual([]);
      const rows = await listSyncFolders(trx, a.ctx, a.mailboxId, { enabledOnly: false });
      expect(rows.map((row) => row.key)).toEqual(["inbox"]);
      expect(await auditRows(trx, a.ctx.orgId, "mailbox.sync_folder_added")).toHaveLength(0);
    });
  });

  test("another organization's context gets mailbox not found and inserts nothing", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      await expect(ensureSyncFolders(trx, b.ctx, a.mailboxId, [offers], at)).rejects.toThrow(HardError);
      await expect(ensureSyncFolders(trx, b.ctx, a.mailboxId, [offers], at)).rejects.toThrow("mailbox not found");
      const rows = await listSyncFolders(trx, a.ctx, a.mailboxId, { enabledOnly: false });
      expect(rows.map((row) => row.key)).toEqual(["inbox"]);
    });
  });
});

describe("setSyncFolderEnabled", () => {
  test("off writes one audit row, the same value again writes none, enabledOnly leaves it out", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await ensureSyncFolders(trx, a.ctx, a.mailboxId, [offers], at);
      expect(await setSyncFolderEnabled(trx, a.ctx, a.mailboxId, "offers", false, "cli", at)).toBe("changed");
      expect((await getSyncFolder(trx, a.ctx, a.mailboxId, "offers"))?.enabled).toBe(false);
      const stamp = await trx
        .selectFrom("mailbox_folders")
        .select("updated_at")
        .where("mailbox_id", "=", a.mailboxId)
        .where("key", "=", "offers")
        .executeTakeFirstOrThrow();
      expect(stamp.updated_at).toEqual(at);
      const audit = await auditRows(trx, a.ctx.orgId, "mailbox.sync_folder_changed");
      expect(audit.map((row) => row.data)).toEqual([{ mailbox_id: a.mailboxId, folder_key: "offers", enabled: false }]);
      expect(audit.map((row) => row.actor)).toEqual(["cli"]);
      expect(audit.map((row) => row.created_at)).toEqual([at]);

      expect(await setSyncFolderEnabled(trx, a.ctx, a.mailboxId, "offers", false, "cli", at)).toBe("same");
      expect(await auditRows(trx, a.ctx.orgId, "mailbox.sync_folder_changed")).toHaveLength(1);
      const enabled = await listSyncFolders(trx, a.ctx, a.mailboxId, { enabledOnly: true });
      expect(enabled.map((row) => row.key)).toEqual(["inbox"]);
    });
  });

  test("off then on clears the cursor", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      await ensureSyncFolders(trx, a.ctx, a.mailboxId, [offers], at);
      const row = await getSyncFolder(trx, a.ctx, a.mailboxId, "offers");
      await updateFolderCursor(
        trx,
        a.ctx,
        folderId(row),
        { uidValidity: null, lastUid: null },
        { uidValidity: 1, lastUid: 500 }
      );

      expect(await setSyncFolderEnabled(trx, a.ctx, a.mailboxId, "offers", false, "cli", at)).toBe("changed");
      const off = await getSyncFolder(trx, a.ctx, a.mailboxId, "offers");
      expect({ uv: off?.uidvalidity, last: off?.last_uid }).toEqual({ uv: 1, last: 500 });
      expect(await setSyncFolderEnabled(trx, a.ctx, a.mailboxId, "offers", true, "cli", at)).toBe("changed");
      const on = await getSyncFolder(trx, a.ctx, a.mailboxId, "offers");
      expect({ enabled: on?.enabled, uv: on?.uidvalidity, last: on?.last_uid }).toEqual({
        enabled: true,
        uv: null,
        last: null,
      });
    });
  });

  test("a key without a row, or another organization's context, gives not_found", async () => {
    await withRollback(db, async (trx) => {
      const { a, b } = await createTwoTenants(trx);
      expect(await setSyncFolderEnabled(trx, a.ctx, a.mailboxId, "social", false, "cli", at)).toBe("not_found");
      await ensureSyncFolders(trx, a.ctx, a.mailboxId, [offers], at);
      expect(await setSyncFolderEnabled(trx, b.ctx, a.mailboxId, "offers", false, "cli", at)).toBe("not_found");
      expect((await getSyncFolder(trx, a.ctx, a.mailboxId, "offers"))?.enabled).toBe(true);
    });
  });
});
