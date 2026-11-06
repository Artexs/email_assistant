import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

import { addMember, createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-06T08:00:00Z");
const hash = "a".repeat(64);

// A statement that must fail aborts the transaction: run it in a savepoint and roll back to it.
async function expectCode(trx: Transaction<DB>, name: string, run: () => Promise<unknown>, code: string) {
  await sql`savepoint ${sql.id(name)}`.execute(trx);
  await expect(run()).rejects.toMatchObject({ code });
  await sql`rollback to savepoint ${sql.id(name)}`.execute(trx);
}

async function addUserOutsideOrg(trx: Transaction<DB>): Promise<string> {
  const user = await trx
    .insertInto("users")
    .values({ email: `stranger-${randomUUID()}@x.test`, display_name: "Stranger" })
    .returning("id")
    .executeTakeFirstOrThrow();
  return user.id;
}

function link(orgId: string, userId: string, chatId: number) {
  return { org_id: orgId, user_id: userId, channel: "telegram", external_chat_id: chatId };
}

function token(orgId: string, userId: string, tokenHash: string) {
  return { org_id: orgId, user_id: userId, token_hash: tokenHash, expires_at: now };
}

function digest(orgId: string, userId: string, overrides?: { slot_key?: string; period_end?: Date }) {
  return {
    org_id: orgId,
    user_id: userId,
    slot_key: "2026-11-06T08:00",
    period_start: now,
    period_end: now,
    ...overrides,
  };
}

function outboxRow(orgId: string, userId: string, overrides?: Record<string, unknown>) {
  return {
    org_id: orgId,
    user_id: userId,
    kind: "sync_ok",
    dedup_key: `key-${randomUUID()}`,
    mailbox_id: null as string | null,
    text: "hello",
    next_attempt_at: now,
    created_at: now,
    ...overrides,
  };
}

describe("telegram schema", () => {
  test("a new org has the default digest times and the mailbox has status_changed_at", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
      const member = await trx
        .selectFrom("memberships")
        .select("digest_times")
        .where("org_id", "=", orgId)
        .where("user_id", "=", userId)
        .executeTakeFirstOrThrow();
      expect(member.digest_times).toEqual(["08:00:00", "16:00:00"]);
      const mailbox = await trx
        .selectFrom("mailboxes")
        .select("status_changed_at")
        .where("id", "=", mailboxId)
        .executeTakeFirstOrThrow();
      expect(mailbox.status_changed_at).not.toBeNull();
    });
  });

  test("the app role inserts, selects, updates and deletes one row in each new table", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);

      const chat = await trx
        .insertInto("chat_links")
        .values(link(orgId, userId, 123))
        .returning(["id", "external_chat_id"])
        .executeTakeFirstOrThrow();
      expect(chat.external_chat_id).toBe("123");
      await trx.updateTable("chat_links").set({ external_chat_id: 124 }).where("id", "=", chat.id).execute();
      expect(await trx.selectFrom("chat_links").selectAll().where("id", "=", chat.id).execute()).toHaveLength(1);
      await trx.deleteFrom("chat_links").where("id", "=", chat.id).execute();

      await trx
        .insertInto("chat_link_tokens")
        .values(token(orgId, userId, hash))
        .execute();
      await trx.updateTable("chat_link_tokens").set({ used_at: now }).where("token_hash", "=", hash).execute();
      expect(
        await trx.selectFrom("chat_link_tokens").selectAll().where("token_hash", "=", hash).execute()
      ).toHaveLength(1);
      await trx.deleteFrom("chat_link_tokens").where("token_hash", "=", hash).execute();

      const dig = await trx
        .insertInto("digests")
        .values(digest(orgId, userId))
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx.updateTable("digests").set({ sent_at: now }).where("id", "=", dig.id).execute();
      expect(await trx.selectFrom("digests").selectAll().where("id", "=", dig.id).execute()).toHaveLength(1);

      const out = await trx
        .insertInto("outbox")
        .values(outboxRow(orgId, userId, { kind: "auth_error", mailbox_id: mailboxId, external_message_id: 99 }))
        .returning(["id", "external_message_id"])
        .executeTakeFirstOrThrow();
      expect(out.external_message_id).toBe("99");
      await trx.updateTable("outbox").set({ attempts: 1 }).where("id", "=", out.id).execute();
      expect(await trx.selectFrom("outbox").selectAll().where("id", "=", out.id).execute()).toHaveLength(1);
      await trx.deleteFrom("outbox").where("id", "=", out.id).execute();
      await trx.deleteFrom("digests").where("id", "=", dig.id).execute();
    });
  });

  test("chat_links guards", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const second = await addMember(trx, orgId);
      const stranger = await addUserOutsideOrg(trx);

      await expectCode(
        trx,
        "zero",
        () =>
          trx
            .insertInto("chat_links")
            .values(link(orgId, userId, 0))
            .execute(),
        "23514"
      );
      await expectCode(
        trx,
        "neg",
        () =>
          trx
            .insertInto("chat_links")
            .values(link(orgId, userId, -5))
            .execute(),
        "23514"
      );

      await trx
        .insertInto("chat_links")
        .values(link(orgId, userId, 500))
        .execute();
      await expectCode(
        trx,
        "same_chat",
        () =>
          trx
            .insertInto("chat_links")
            .values(link(orgId, second, 500))
            .execute(),
        "23505"
      );
      await expectCode(
        trx,
        "same_member",
        () =>
          trx
            .insertInto("chat_links")
            .values(link(orgId, userId, 501))
            .execute(),
        "23505"
      );
      await expectCode(
        trx,
        "not_member",
        () =>
          trx
            .insertInto("chat_links")
            .values(link(orgId, stranger, 502))
            .execute(),
        "23503"
      );
    });
  });

  test("chat_link_tokens guards", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      await expectCode(
        trx,
        "short",
        () =>
          trx
            .insertInto("chat_link_tokens")
            .values(token(orgId, userId, "abc"))
            .execute(),
        "23514"
      );
      await expectCode(
        trx,
        "upper",
        () =>
          trx
            .insertInto("chat_link_tokens")
            .values(token(orgId, userId, "A".repeat(64)))
            .execute(),
        "23514"
      );
    });
  });

  test("digests guards", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      await expectCode(
        trx,
        "slot",
        () =>
          trx
            .insertInto("digests")
            .values(digest(orgId, userId, { slot_key: "2026-11-06 08:00" }))
            .execute(),
        "23514"
      );
      await expectCode(
        trx,
        "period",
        () =>
          trx
            .insertInto("digests")
            .values(digest(orgId, userId, { period_end: new Date(now.getTime() - 1000) }))
            .execute(),
        "23514"
      );
      await trx.insertInto("digests").values(digest(orgId, userId)).execute();
      await expectCode(trx, "dup", () => trx.insertInto("digests").values(digest(orgId, userId)).execute(), "23505");
    });
  });

  test("outbox guards", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
      const second = await addMember(trx, orgId);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      const dig = await trx
        .insertInto("digests")
        .values(digest(orgId, userId))
        .returning("id")
        .executeTakeFirstOrThrow();

      const insert = (overrides: Record<string, unknown>, user = userId) =>
        trx
          .insertInto("outbox")
          .values(outboxRow(orgId, user, { mailbox_id: mailboxId, ...overrides }))
          .execute();

      await expectCode(trx, "text_long", () => insert({ text: "x".repeat(4097) }), "23514");
      await insert({ text: "x".repeat(4096) });
      await expectCode(trx, "text_empty", () => insert({ text: "" }), "23514");
      await expectCode(trx, "digest_no_id", () => insert({ kind: "digest" }), "23514");
      await expectCode(
        trx,
        "urgent_digest",
        () => insert({ kind: "urgent", email_id: emailId, digest_id: dig.id }),
        "23514"
      );
      await expectCode(trx, "urgent_no_email", () => insert({ kind: "urgent" }), "23514");
      await expectCode(trx, "auth_no_mailbox", () => insert({ kind: "auth_error", mailbox_id: null }), "23514");
      await expectCode(trx, "error_code", () => insert({ error_code: "Bad Request" }), "23514");
      await expectCode(trx, "sent_no_time", () => insert({ status: "sent" }), "23514");
      await expectCode(trx, "sending_no_lock", () => insert({ status: "sending" }), "23514");
      await expectCode(trx, "buttons", () => insert({ buttons: sql`'{}'::jsonb` }), "23514");

      await insert({ dedup_key: "same" });
      await expectCode(trx, "dup", () => insert({ dedup_key: "same" }), "23505");
      await insert({ dedup_key: "same" }, second);
    });
  });

  test("cascades from membership, email and mailbox", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
      const member = await addMember(trx, orgId);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);

      await trx
        .insertInto("chat_links")
        .values(link(orgId, member, 700))
        .execute();
      await trx
        .insertInto("chat_link_tokens")
        .values(token(orgId, member, hash))
        .execute();
      const dig = await trx
        .insertInto("digests")
        .values(digest(orgId, member))
        .returning("id")
        .executeTakeFirstOrThrow();
      await trx
        .insertInto("outbox")
        .values(outboxRow(orgId, member, { kind: "digest", digest_id: dig.id }))
        .execute();
      await trx.deleteFrom("memberships").where("org_id", "=", orgId).where("user_id", "=", member).execute();
      for (const table of ["chat_links", "chat_link_tokens", "digests", "outbox"] as const) {
        const rows = await trx.selectFrom(table).select("user_id").where("user_id", "=", member).execute();
        expect(rows).toHaveLength(0);
      }

      await trx
        .insertInto("outbox")
        .values(outboxRow(orgId, userId, { kind: "urgent", email_id: emailId, dedup_key: "urgent" }))
        .execute();
      await trx.deleteFrom("emails").where("id", "=", emailId).execute();
      expect(await trx.selectFrom("outbox").select("id").where("dedup_key", "=", "urgent").execute()).toHaveLength(0);

      await trx
        .insertInto("outbox")
        .values(outboxRow(orgId, userId, { kind: "auth_error", mailbox_id: mailboxId, dedup_key: "auth" }))
        .execute();
      await trx.deleteFrom("mailboxes").where("id", "=", mailboxId).execute();
      expect(await trx.selectFrom("outbox").select("id").where("dedup_key", "=", "auth").execute()).toHaveLength(0);
    });
  });
});
