import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { tombstoneKeyHash } from "../../src/platform/crypto";
import type { DB } from "../../src/platform/db";

import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

async function insertOrg(trx: Transaction<DB>, name: string) {
  const org = await trx
    .insertInto("organizations")
    .values({ name, timezone: "Europe/Warsaw" })
    .returning("id")
    .executeTakeFirstOrThrow();
  return org.id;
}

async function insertMailbox(trx: Transaction<DB>, orgId: string, address: string) {
  const mailbox = await trx
    .insertInto("mailboxes")
    .values({
      org_id: orgId,
      address,
      imap_host: "imap.x.test",
      imap_port: 993,
      smtp_host: "smtp.x.test",
      smtp_port: 465,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return mailbox.id;
}

function emailRow(orgId: string, mailboxId: string, dedupKey: string) {
  return {
    org_id: orgId,
    mailbox_id: mailboxId,
    dedup_key: dedupKey,
    content_hash: "hash-1",
    uid: 1,
    thread_key: "thread-1",
    received_at: new Date("2026-11-03T10:00:00Z"),
  };
}

describe("mail schema", () => {
  test("an org, a mailbox and an email insert with the defaults", async () => {
    await withRollback(db, async (trx) => {
      const orgId = await insertOrg(trx, "Org A");
      const mailboxId = await insertMailbox(trx, orgId, "a@x.test");
      const email = await trx
        .insertInto("emails")
        .values(emailRow(orgId, mailboxId, "mid:1"))
        .returning(["status", "folder", "attempts", "to_addresses"])
        .executeTakeFirstOrThrow();
      expect(email).toEqual({ status: "pending", folder: "INBOX", attempts: 0, to_addresses: [] });
      const mailbox = await trx
        .selectFrom("mailboxes")
        .select(["protocol", "status", "capabilities", "folder_map"])
        .where("id", "=", mailboxId)
        .executeTakeFirstOrThrow();
      expect(mailbox).toEqual({ protocol: "imap", status: "active", capabilities: {}, folder_map: {} });
    });
  });

  test("an email with the mailbox of org A and the org_id of org B fails with 23503", async () => {
    await withRollback(db, async (trx) => {
      const orgA = await insertOrg(trx, "Org A");
      const orgB = await insertOrg(trx, "Org B");
      const mailboxA = await insertMailbox(trx, orgA, "a@x.test");
      await sql`savepoint cross_org`.execute(trx);
      await expect(
        trx
          .insertInto("emails")
          .values(emailRow(orgB, mailboxA, "mid:1"))
          .execute()
      ).rejects.toMatchObject({ code: "23503" });
      await sql`rollback to savepoint cross_org`.execute(trx);
    });
  });

  test("the same dedup_key fails in one mailbox and works in another mailbox", async () => {
    await withRollback(db, async (trx) => {
      const orgId = await insertOrg(trx, "Org A");
      const first = await insertMailbox(trx, orgId, "a@x.test");
      const second = await insertMailbox(trx, orgId, "b@x.test");
      await trx
        .insertInto("emails")
        .values(emailRow(orgId, first, "mid:1"))
        .execute();
      await sql`savepoint duplicate_dedup_key`.execute(trx);
      await expect(
        trx
          .insertInto("emails")
          .values(emailRow(orgId, first, "mid:1"))
          .execute()
      ).rejects.toMatchObject({
        code: "23505",
      });
      await sql`rollback to savepoint duplicate_dedup_key`.execute(trx);
      await trx
        .insertInto("emails")
        .values(emailRow(orgId, second, "mid:1"))
        .execute();
      const rows = await trx.selectFrom("emails").select("mailbox_id").where("dedup_key", "=", "mid:1").execute();
      expect(rows).toHaveLength(2);
    });
  });

  test("an unknown email status fails with 23514", async () => {
    await withRollback(db, async (trx) => {
      const orgId = await insertOrg(trx, "Org A");
      const mailboxId = await insertMailbox(trx, orgId, "a@x.test");
      await sql`savepoint bad_status`.execute(trx);
      await expect(
        trx
          .insertInto("emails")
          .values({ ...emailRow(orgId, mailboxId, "mid:1"), status: "x" })
          .execute()
      ).rejects.toMatchObject({ code: "23514" });
      await sql`rollback to savepoint bad_status`.execute(trx);
    });
  });

  test("a mailbox with the same address in other case in the same org fails with 23505", async () => {
    await withRollback(db, async (trx) => {
      const orgId = await insertOrg(trx, "Org A");
      await insertMailbox(trx, orgId, "a@x.test");
      await sql`savepoint duplicate_address`.execute(trx);
      await expect(insertMailbox(trx, orgId, "A@X.test")).rejects.toMatchObject({ code: "23505" });
      await sql`rollback to savepoint duplicate_address`.execute(trx);
    });
  });

  test("deleting a mailbox deletes its emails, credentials and settings", async () => {
    await withRollback(db, async (trx) => {
      const orgId = await insertOrg(trx, "Org A");
      const mailboxId = await insertMailbox(trx, orgId, "a@x.test");
      await trx
        .insertInto("emails")
        .values(emailRow(orgId, mailboxId, "mid:1"))
        .execute();
      await trx
        .insertInto("mailbox_credentials")
        .values({
          mailbox_id: mailboxId,
          org_id: orgId,
          encrypted_secret: "ciphertext",
          secret_kind: "password",
          key_version: 1,
        })
        .execute();
      await trx.insertInto("mailbox_settings").values({ mailbox_id: mailboxId, org_id: orgId }).execute();

      await trx.deleteFrom("mailboxes").where("id", "=", mailboxId).execute();

      const emails = await trx.selectFrom("emails").select("id").where("mailbox_id", "=", mailboxId).execute();
      const credentials = await trx
        .selectFrom("mailbox_credentials")
        .select("mailbox_id")
        .where("mailbox_id", "=", mailboxId)
        .execute();
      const settings = await trx
        .selectFrom("mailbox_settings")
        .select("mailbox_id")
        .where("mailbox_id", "=", mailboxId)
        .execute();
      expect(emails).toHaveLength(0);
      expect(credentials).toHaveLength(0);
      expect(settings).toHaveLength(0);
    });
  });
  describe("mailbox_folders", () => {
    async function insertFolder(
      trx: Transaction<DB>,
      mailboxId: string,
      orgId: string,
      values: { key: string; path: string; role: string; enabled?: boolean }
    ) {
      await sql`savepoint folder_insert`.execute(trx);
      try {
        await trx
          .insertInto("mailbox_folders")
          .values({ org_id: orgId, mailbox_id: mailboxId, ...values })
          .execute();
      } catch (error) {
        await sql`rollback to savepoint folder_insert`.execute(trx);
        throw error;
      }
    }

    test("the INBOX row rules: key, path and enabled are checked", async () => {
      await withRollback(db, async (trx) => {
        const orgId = await insertOrg(trx, "Org A");
        const mailboxId = await insertMailbox(trx, orgId, "a@x.test");
        await expect(
          insertFolder(trx, mailboxId, orgId, { key: "offers", path: "INBOX", role: "inbox" })
        ).rejects.toThrow("mailbox_folders_inbox_key_check");
        await expect(
          insertFolder(trx, mailboxId, orgId, { key: "inbox", path: "Oferty", role: "inbox" })
        ).rejects.toThrow("mailbox_folders_inbox_row_check");
        await expect(
          insertFolder(trx, mailboxId, orgId, { key: "inbox", path: "INBOX", role: "inbox", enabled: false })
        ).rejects.toThrow("mailbox_folders_inbox_row_check");
        await insertFolder(trx, mailboxId, orgId, { key: "inbox", path: "INBOX", role: "inbox" });
      });
    });

    test("one junk row per mailbox and one row per path", async () => {
      await withRollback(db, async (trx) => {
        const orgId = await insertOrg(trx, "Org A");
        const mailboxId = await insertMailbox(trx, orgId, "a@x.test");
        await insertFolder(trx, mailboxId, orgId, { key: "junk", path: "Spam", role: "junk" });
        await expect(
          insertFolder(trx, mailboxId, orgId, { key: "junk_b", path: "Spam2", role: "junk" })
        ).rejects.toThrow("mailbox_folders_one_junk_idx");
        await insertFolder(trx, mailboxId, orgId, { key: "offers", path: "Oferty", role: "sort" });
        await expect(
          insertFolder(trx, mailboxId, orgId, { key: "offers_b", path: "Oferty", role: "sort" })
        ).rejects.toThrow("mailbox_folders_mailbox_id_path_key");
      });
    });

    test("a folder row with the mailbox of org A and the org_id of org B fails with 23503", async () => {
      await withRollback(db, async (trx) => {
        const orgA = await insertOrg(trx, "Org A");
        const orgB = await insertOrg(trx, "Org B");
        const mailboxA = await insertMailbox(trx, orgA, "a@x.test");
        await expect(
          insertFolder(trx, mailboxA, orgB, { key: "offers", path: "Oferty", role: "sort" })
        ).rejects.toMatchObject({
          code: "23503",
        });
      });
    });
  });

  test("emails_moved_idx is partial on folder <> source_folder", async () => {
    const rows = await sql<{ indexdef: string }>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'emails_moved_idx'
    `.execute(db);
    expect(rows.rows[0]?.indexdef).toContain("folder <> source_folder");
  });

  describe("sent_emails and mailbox_sent_sync", () => {
    const AT = new Date("2026-11-10T10:00:00Z");

    function sentRow(orgId: string, mailboxId: string, extra: Record<string, unknown> = {}) {
      return {
        org_id: orgId,
        mailbox_id: mailboxId,
        dedup_key: "mid:<a@x.test>:h1",
        path: "Sent",
        uidvalidity: 7,
        uid: 1,
        thread_key: "<a@x.test>",
        origin: "user",
        content: "pending",
        sent_at: AT,
        internal_date: AT,
        ...extra,
      };
    }

    async function insertSent(trx: Transaction<DB>, values: ReturnType<typeof sentRow>) {
      await sql`savepoint sent_insert`.execute(trx);
      try {
        return await trx.insertInto("sent_emails").values(values).returning("id").execute();
      } catch (error) {
        await sql`rollback to savepoint sent_insert`.execute(trx);
        throw error;
      }
    }

    async function insertState(trx: Transaction<DB>, orgId: string, mailboxId: string, extra: Record<string, unknown>) {
      await sql`savepoint state_insert`.execute(trx);
      try {
        await trx
          .insertInto("mailbox_sent_sync")
          .values({ mailbox_id: mailboxId, org_id: orgId, ...extra })
          .execute();
      } catch (error) {
        await sql`rollback to savepoint state_insert`.execute(trx);
        throw error;
      }
    }

    test("1: the minimal row inserts; the arrays default to empty", async () => {
      await withRollback(db, async (trx) => {
        const orgId = await insertOrg(trx, "Org A");
        const mailboxId = await insertMailbox(trx, orgId, "a@x.test");
        await insertSent(trx, sentRow(orgId, mailboxId));
        const row = await trx
          .selectFrom("sent_emails")
          .select(["references_ids", "to_addresses", "cc_addresses", "body_text"])
          .where("mailbox_id", "=", mailboxId)
          .executeTakeFirstOrThrow();
        expect(row).toEqual({ references_ids: [], to_addresses: [], cc_addresses: [], body_text: null });
      });
    });

    test("2: a mailbox of org A with the org_id of org B fails with 23503, in both tables", async () => {
      await withRollback(db, async (trx) => {
        const orgA = await insertOrg(trx, "Org A");
        const orgB = await insertOrg(trx, "Org B");
        const mailboxA = await insertMailbox(trx, orgA, "a@x.test");
        await expect(insertSent(trx, sentRow(orgB, mailboxA))).rejects.toMatchObject({ code: "23503" });
        await expect(insertState(trx, orgB, mailboxA, {})).rejects.toMatchObject({ code: "23503" });
      });
    });

    test("3: the same (mailbox, dedup_key) twice fails with 23505; another mailbox inserts", async () => {
      await withRollback(db, async (trx) => {
        const orgId = await insertOrg(trx, "Org A");
        const mailboxA = await insertMailbox(trx, orgId, "a@x.test");
        const mailboxB = await insertMailbox(trx, orgId, "b@x.test");
        await insertSent(trx, sentRow(orgId, mailboxA));
        await expect(insertSent(trx, sentRow(orgId, mailboxA))).rejects.toMatchObject({ code: "23505" });
        await insertSent(trx, sentRow(orgId, mailboxB));
      });
    });

    test("4: an unknown content, an unknown origin and an empty path fail with 23514", async () => {
      await withRollback(db, async (trx) => {
        const orgId = await insertOrg(trx, "Org A");
        const mailboxId = await insertMailbox(trx, orgId, "a@x.test");
        for (const extra of [{ content: "new" }, { origin: "other" }, { path: "" }, { path: "x".repeat(201) }]) {
          await expect(insertSent(trx, sentRow(orgId, mailboxId, extra))).rejects.toMatchObject({ code: "23514" });
        }
      });
    });

    test("5: a system row needs an action and headers_only; a user row may hold an action id", async () => {
      await withRollback(db, async (trx) => {
        const orgId = await insertOrg(trx, "Org A");
        const mailboxId = await insertMailbox(trx, orgId, "a@x.test");
        const action_id = "11111111-1111-4111-8111-111111111111";
        await expect(insertSent(trx, sentRow(orgId, mailboxId, { origin: "system" }))).rejects.toMatchObject({
          code: "23514",
        });
        await expect(
          insertSent(trx, sentRow(orgId, mailboxId, { origin: "system", action_id, content: "pending" }))
        ).rejects.toMatchObject({ code: "23514" });
        await expect(
          insertSent(trx, sentRow(orgId, mailboxId, { origin: "system", content: "headers_only" }))
        ).rejects.toMatchObject({ code: "23514" });
        await insertSent(
          trx,
          sentRow(orgId, mailboxId, { dedup_key: "k:1", origin: "system", action_id, content: "headers_only" })
        );
        await insertSent(trx, sentRow(orgId, mailboxId, { dedup_key: "k:2", origin: "user", action_id }));
      });
    });

    test("6: body_text needs content stored", async () => {
      await withRollback(db, async (trx) => {
        const orgId = await insertOrg(trx, "Org A");
        const mailboxId = await insertMailbox(trx, orgId, "a@x.test");
        await expect(
          insertSent(trx, sentRow(orgId, mailboxId, { body_text: "hello", content: "pending" }))
        ).rejects.toMatchObject({ code: "23514" });
        await insertSent(trx, sentRow(orgId, mailboxId, { body_text: "hello", content: "stored" }));
      });
    });

    test("7: the state row checks: enabled needs enabled_at, off holds no cursor, a cursor is whole, codes are closed", async () => {
      await withRollback(db, async (trx) => {
        const orgId = await insertOrg(trx, "Org A");
        const mailboxId = await insertMailbox(trx, orgId, "a@x.test");
        const bad: Record<string, unknown>[] = [
          { enabled: true },
          { enabled: false, enabled_at: AT },
          { enabled: false, path: "Sent", uidvalidity: 7, last_uid: 3 },
          { enabled: false, last_error_code: "failed" },
          { enabled: false, first_pass_at: AT },
          { enabled: true, enabled_at: AT, uidvalidity: 7 },
          { enabled: true, enabled_at: AT, last_uid: 3 },
          { enabled: true, enabled_at: AT, last_error_code: "other" },
          { enabled: true, enabled_at: AT, path: "" },
        ];
        for (const extra of bad) {
          await expect(insertState(trx, orgId, mailboxId, extra)).rejects.toMatchObject({ code: "23514" });
        }
        await insertState(trx, orgId, mailboxId, {});
        await trx.deleteFrom("mailbox_sent_sync").where("mailbox_id", "=", mailboxId).execute();
        await insertState(trx, orgId, mailboxId, {
          enabled: true,
          enabled_at: AT,
          path: "Sent",
          uidvalidity: 7,
          last_uid: 3,
          first_pass_at: AT,
          last_pass_at: AT,
          last_error_code: "failed",
        });
      });
    });

    test("8: deleting a mailbox deletes its sent rows and its state row", async () => {
      await withRollback(db, async (trx) => {
        const orgId = await insertOrg(trx, "Org A");
        const mailboxId = await insertMailbox(trx, orgId, "a@x.test");
        await insertSent(trx, sentRow(orgId, mailboxId));
        await insertState(trx, orgId, mailboxId, { enabled: true, enabled_at: AT });
        await trx.deleteFrom("mailboxes").where("id", "=", mailboxId).execute();
        const sent = await trx.selectFrom("sent_emails").select("id").where("mailbox_id", "=", mailboxId).execute();
        const state = await trx
          .selectFrom("mailbox_sent_sync")
          .select("mailbox_id")
          .where("mailbox_id", "=", mailboxId)
          .execute();
        expect(sent).toHaveLength(0);
        expect(state).toHaveLength(0);
      });
    });

    test("9: a sent row whose base key has a tombstone inserts nothing and raises no error", async () => {
      await withRollback(db, async (trx) => {
        const orgId = await insertOrg(trx, "Org A");
        const mailboxId = await insertMailbox(trx, orgId, "a@x.test");
        await trx
          .insertInto("dsr_tombstones")
          .values({ org_id: orgId, key_hash: tombstoneKeyHash("mid:<a@x.test>:h1") })
          .execute();
        expect(await insertSent(trx, sentRow(orgId, mailboxId))).toHaveLength(0);
        expect(await insertSent(trx, sentRow(orgId, mailboxId, { dedup_key: "mid:<a@x.test>:h1#2" }))).toHaveLength(0);
        expect(await insertSent(trx, sentRow(orgId, mailboxId, { dedup_key: "mid:<b@x.test>:h1" }))).toHaveLength(1);
      });
    });
  });
});
