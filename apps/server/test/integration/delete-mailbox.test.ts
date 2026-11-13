import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { insertOutbox, type OutboxKind } from "../../src/modules/channels";
import { insertDefaultSettings } from "../../src/modules/config";
import { insertInboxFolder, insertMailbox } from "../../src/modules/mail/repo";
import { insertDigest } from "../../src/modules/reports";
import type { DB, TenantContext } from "../../src/platform/db";

import { createOrgWithMailbox, linkChat, randomChatId, testCapabilities } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { countMailboxRows, fillMailbox } from "./mailbox-rows";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

let slotCounter = 0;
const now = new Date("2026-11-10T10:00:00Z");

// A statement that must fail aborts the transaction: run it in a savepoint and roll back to it.
async function expectCode(trx: Transaction<DB>, name: string, run: () => Promise<unknown>, code: string) {
  await sql`savepoint ${sql.id(name)}`.execute(trx);
  await expect(run()).rejects.toMatchObject({ code });
  await sql`rollback to savepoint ${sql.id(name)}`.execute(trx);
}

const deleteMailbox = (trx: Transaction<DB>, orgId: string, mailboxId: string) =>
  sql`SELECT delete_mailbox(${orgId}::uuid, ${mailboxId}::uuid)`.execute(trx);

async function insertDigestOutbox(
  trx: Transaction<DB>,
  ctx: TenantContext,
  userId: string,
  status: "pending" | "sending" | "sent" | "failed",
  text: string
): Promise<string> {
  const digestId = await insertDigest(trx, ctx, {
    userId,
    slotKey: `2026-11-${String(10 + (slotCounter += 1)).padStart(2, "0")}T08:00`,
    periodStart: new Date("2026-11-09T10:00:00Z"),
    periodEnd: now,
  });
  const outboxId = await insertOutbox(trx, ctx, {
    userId,
    kind: "digest",
    dedupKey: `digest:${digestId}`,
    digestId: digestId ?? undefined,
    message: { text, buttons: [] },
    view: { text, buttons: [] },
    createdAt: now,
    nextAttemptAt: now,
  });
  if (!outboxId || !digestId) throw new Error("digest rows were not inserted");
  await trx
    .updateTable("outbox")
    .set({
      status,
      sent_at: status === "sent" ? now : null,
      locked_at: status === "sending" ? now : null,
    })
    .where("id", "=", outboxId)
    .execute();
  return outboxId;
}

async function setup(trx: Transaction<DB>) {
  const a = await createOrgWithMailbox(trx);
  const ctxA = { orgId: a.orgId };
  const m2 = randomUUID();
  await insertMailbox(trx, ctxA, {
    id: m2,
    address: `second-${m2}@x.test`,
    imapHost: "imap.x.test",
    imapPort: 993,
    smtpHost: "smtp.x.test",
    smtpPort: 465,
    capabilities: testCapabilities,
    folderMap: {},
  });
  await insertInboxFolder(trx, ctxA, m2);
  await insertDefaultSettings(trx, ctxA, m2);
  const b = await createOrgWithMailbox(trx);
  const ctxB = { orgId: b.orgId };

  const m1Ids = await fillMailbox(trx, ctxA, a.mailboxId, a.userId);
  const m2Ids = await fillMailbox(trx, ctxA, m2, a.userId);
  const m3Ids = await fillMailbox(trx, ctxB, b.mailboxId, b.userId);
  await linkChat(trx, ctxA, a.userId, randomChatId(), now);
  await linkChat(trx, ctxB, b.userId, randomChatId(), now);

  const digestA = {
    pending: await insertDigestOutbox(trx, ctxA, a.userId, "pending", "Digest pending"),
    sending: await insertDigestOutbox(trx, ctxA, a.userId, "sending", "Digest sending"),
    sent: await insertDigestOutbox(trx, ctxA, a.userId, "sent", "Digest sent"),
    failed: await insertDigestOutbox(trx, ctxA, a.userId, "failed", "Digest failed"),
  };
  const digestB = await insertDigestOutbox(trx, ctxB, b.userId, "sent", "Digest of B");

  const before = {
    m1: await countMailboxRows(trx, a.orgId, m1Ids),
    m2: await countMailboxRows(trx, a.orgId, m2Ids),
    m3: await countMailboxRows(trx, b.orgId, m3Ids),
  };
  return { a, b, ctxA, ctxB, m1Ids, m2Ids, m3Ids, digestA, digestB, before };
}

const allZero = {
  mailboxes: 0,
  mailbox_credentials: 0,
  mailbox_settings: 0,
  mailbox_folders: 0,
  emails: 0,
  triage_results: 0,
  triage_feedback: 0,
  actions: 0,
  delegations: 0,
  sender_rules: 0,
  audit_log_by_email: 0,
  audit_log_by_action: 0,
  audit_log_by_mailbox: 0,
  outbox_by_mailbox: 0,
  outbox_by_email: 0,
};

async function outboxView(trx: Transaction<DB>, id: string): Promise<unknown> {
  const row = await trx.selectFrom("outbox").select("view").where("id", "=", id).executeTakeFirstOrThrow();
  return row.view;
}

async function outboxText(trx: Transaction<DB>, id: string): Promise<string | undefined> {
  const row = await trx.selectFrom("outbox").select("text").where("id", "=", id).executeTakeFirst();
  return row?.text ?? undefined;
}

describe("delete_mailbox", () => {
  test("removes every row of the mailbox and keeps the rows of the others", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      for (const row of Object.values(s.before.m1)) expect(row).toBeGreaterThan(0);

      await deleteMailbox(trx, s.a.orgId, s.a.mailboxId);

      expect(await countMailboxRows(trx, s.a.orgId, s.m1Ids)).toEqual(allZero);
      expect(await countMailboxRows(trx, s.a.orgId, s.m2Ids)).toEqual(s.before.m2);
      expect(await countMailboxRows(trx, s.b.orgId, s.m3Ids)).toEqual(s.before.m3);
    });
  });

  test("drops pending digests and clears the text of sent ones", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await deleteMailbox(trx, s.a.orgId, s.a.mailboxId);

      expect(await outboxText(trx, s.digestA.pending)).toBeUndefined();
      expect(await outboxText(trx, s.digestA.sending)).toBeUndefined();
      expect(await outboxText(trx, s.digestA.sent)).toBe("[removed]");
      expect(await outboxText(trx, s.digestA.failed)).toBe("[removed]");
      expect(await outboxText(trx, s.digestB)).toBe("Digest of B");
      expect(await outboxView(trx, s.digestA.sent)).toEqual({});
      expect(await outboxView(trx, s.digestA.failed)).toEqual({});
      expect(await outboxView(trx, s.digestB)).toEqual({ text: "Digest of B", buttons: [] });
      const digests = await trx
        .selectFrom("digests")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("org_id", "=", s.a.orgId)
        .executeTakeFirstOrThrow();
      expect(Number(digests.n)).toBe(4);
    });
  });

  test("refuses a mailbox of another organization", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await expectCode(trx, "other_org", () => deleteMailbox(trx, s.b.orgId, s.a.mailboxId), "P0002");
      expect(await countMailboxRows(trx, s.a.orgId, s.m1Ids)).toEqual(s.before.m1);
    });
  });

  test("refuses an unknown mailbox", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      await expectCode(trx, "unknown", () => deleteMailbox(trx, orgId, randomUUID()), "P0002");
    });
  });

  test("grants EXECUTE to app only, as SECURITY DEFINER with a fixed search_path", async () => {
    await withRollback(db, async (trx) => {
      const grant = await sql<{
        ok: boolean;
      }>`SELECT has_function_privilege('app', 'delete_mailbox(uuid, uuid)', 'EXECUTE') AS ok`.execute(trx);
      expect(grant.rows[0]?.ok).toBe(true);
      const publicGrant = await sql<{
        ok: boolean;
      }>`SELECT has_function_privilege('public', 'delete_mailbox(uuid, uuid)', 'EXECUTE') AS ok`.execute(trx);
      expect(publicGrant.rows[0]?.ok).toBe(false);

      const proc = await sql<{ acl: string[] | null; prosecdef: boolean; proconfig: string[] | null }>`
        SELECT proacl::text[] AS acl, prosecdef, proconfig FROM pg_proc WHERE proname = 'delete_mailbox'`.execute(trx);
      const row = proc.rows[0];
      expect(row?.prosecdef).toBe(true);
      expect(row?.proconfig).toContain("search_path=pg_catalog, public, pg_temp");
      expect(row?.acl).not.toBeNull();
      expect(row?.acl?.some((entry) => entry.startsWith("app="))).toBe(true);
      for (const entry of row?.acl ?? []) expect(entry.startsWith("=")).toBe(false);
    });
  });

  test("a temporary table cannot swap the mailboxes table", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      await sql`CREATE TEMP TABLE mailboxes (id uuid, org_id uuid)`.execute(trx);
      await sql`INSERT INTO pg_temp.mailboxes (id, org_id) VALUES (${s.m2Ids.mailboxId}::uuid, ${s.b.orgId}::uuid)`.execute(
        trx
      );
      await expectCode(trx, "temp_table", () => deleteMailbox(trx, s.b.orgId, s.m2Ids.mailboxId), "P0002");
      // The count helper reads `mailboxes` unqualified: drop the temporary table first.
      await sql`DROP TABLE pg_temp.mailboxes`.execute(trx);
      expect(await countMailboxRows(trx, s.a.orgId, s.m2Ids)).toEqual(s.before.m2);
    });
  });

  test("app cannot delete an audit row directly", async () => {
    await withRollback(db, async (trx) => {
      const s = await setup(trx);
      const row = await trx
        .selectFrom("audit_log")
        .select("id")
        .where("org_id", "=", s.a.orgId)
        .executeTakeFirstOrThrow();
      await expectCode(
        trx,
        "audit_delete",
        () => trx.deleteFrom("audit_log").where("id", "=", row.id).execute(),
        "42501"
      );
    });
  });

  test("the mailbox_removed kind needs no mailbox, email or digest; an unknown kind is refused", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      const ctx = { orgId };
      const row = (kind: string) => ({
        userId,
        kind: kind as OutboxKind,
        dedupKey: `${kind}:${randomUUID()}`,
        message: { text: "Mailbox removed", buttons: [] },
        createdAt: now,
        nextAttemptAt: now,
      });
      expect(await insertOutbox(trx, ctx, row("mailbox_removed"))).not.toBeNull();
      await expectCode(trx, "nonsense", () => insertOutbox(trx, ctx, row("nonsense")), "23514");
    });
  });
});
