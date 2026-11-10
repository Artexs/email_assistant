import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

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
});
