import { resolve } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";

import { ensureSyncFolders, setSyncFolderEnabled } from "../../src/modules/mail/folders";
import { getSyncFolder, listSyncFolders } from "../../src/modules/mail/repo";
import { describeSyncFolder } from "../../src/scripts/mailbox-settings-args";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();
const repoRoot = resolve(import.meta.dir, "../../../..");
const settingsScript = resolve(import.meta.dir, "../../src/scripts/mailbox-settings.ts");
const at = new Date("2026-11-09T10:00:00.000Z");
const later = new Date("2026-11-09T10:05:00.000Z");
const offers = { key: "offers", path: "Oferty", role: "sort" } as const;

afterAll(async () => {
  await db.destroy();
});

async function runSettings(args: string[]) {
  const proc = Bun.spawn(["bun", settingsScript, ...args], {
    cwd: repoRoot,
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

describe("mailbox:settings sync-folder", () => {
  // The script passes a plain Db: the function opens its own transaction.
  test("off, then on with a plain Db: audit rows with actor cli, the cursor is null", async () => {
    const created = await db.transaction().execute(async (trx) => {
      const box = await createOrgWithMailbox(trx);
      await ensureSyncFolders(trx, { orgId: box.orgId }, box.mailboxId, [offers], at);
      await trx
        .updateTable("mailbox_folders")
        .set({ uidvalidity: 1, last_uid: 40 })
        .where("mailbox_id", "=", box.mailboxId)
        .where("key", "=", "offers")
        .execute();
      return box;
    });
    const ctx = { orgId: created.orgId };
    try {
      expect(await setSyncFolderEnabled(db, ctx, created.mailboxId, "offers", false, "cli", at)).toBe("changed");
      expect((await getSyncFolder(db, ctx, created.mailboxId, "offers"))?.enabled).toBe(false);
      expect(await setSyncFolderEnabled(db, ctx, created.mailboxId, "offers", true, "cli", later)).toBe("changed");
      const row = await getSyncFolder(db, ctx, created.mailboxId, "offers");
      expect({ enabled: row?.enabled, uv: row?.uidvalidity, last: row?.last_uid }).toEqual({
        enabled: true,
        uv: null,
        last: null,
      });
      const audit = await db
        .selectFrom("audit_log")
        .select(["actor", "data"])
        .where("org_id", "=", ctx.orgId)
        .where("event", "=", "mailbox.sync_folder_changed")
        .orderBy("created_at")
        .execute();
      expect(audit.map((item) => item.actor)).toEqual(["cli", "cli"]);
      expect(audit.map((item) => item.data)).toEqual([
        { mailbox_id: created.mailboxId, folder_key: "offers", enabled: false },
        { mailbox_id: created.mailboxId, folder_key: "offers", enabled: true },
      ]);
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
    }
  });

  test("show lines name the INBOX row and the offers row", async () => {
    await withRollback(db, async (trx) => {
      const box = await createOrgWithMailbox(trx);
      const ctx = { orgId: box.orgId };
      await ensureSyncFolders(trx, ctx, box.mailboxId, [offers], at);
      const lines = (await listSyncFolders(trx, ctx, box.mailboxId, { enabledOnly: false })).map(describeSyncFolder);
      expect(lines).toEqual([
        "sync folder inbox: on, role inbox, path INBOX, cursor none",
        "sync folder offers: on, role sort, path Oferty, cursor none",
      ]);
    });
  });

  test("the CLI exits 1 for a missing folder row, and for --key inbox", async () => {
    const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    try {
      const args = ["sync-folder", "--org-id", created.orgId, "--mailbox-id", created.mailboxId, "--value", "off"];
      const missing = await runSettings([...args, "--key", "offers"]);
      expect(missing.code).toBe(1);
      expect(missing.stderr).toContain("sync folder offers: no such folder row");

      const inbox = await runSettings([...args, "--key", "inbox"]);
      expect(inbox.code).toBe(1);
      expect(inbox.stderr).toContain("usage");
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
    }
  });
});
