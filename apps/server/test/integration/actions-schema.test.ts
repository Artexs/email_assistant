import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-07T10:00:00Z");

interface ActionOverrides {
  status: string;
  applied_at?: Date | null;
  reverses_action_id?: string | null;
}

async function insertAction(
  trx: Transaction<DB>,
  orgId: string,
  emailId: string,
  overrides: ActionOverrides
): Promise<string> {
  const row = await trx
    .insertInto("actions")
    .values({
      org_id: orgId,
      email_id: emailId,
      type: "move",
      idempotency_key: `test:${randomUUID()}`,
      ...overrides,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function insertOutbox(
  trx: Transaction<DB>,
  orgId: string,
  userId: string,
  kind: string,
  extra: { email_id?: string; digest_id?: string }
): Promise<void> {
  await trx
    .insertInto("outbox")
    .values({
      org_id: orgId,
      user_id: userId,
      kind,
      dedup_key: `test:${randomUUID()}`,
      text: "x",
      next_attempt_at: now,
      created_at: now,
      ...extra,
    })
    .execute();
}

// A statement that must fail aborts the transaction: run it in a savepoint and roll back to it.
async function expectCode(trx: Transaction<DB>, name: string, run: () => Promise<unknown>, code: string) {
  await sql`savepoint ${sql.id(name)}`.execute(trx);
  await expect(run()).rejects.toMatchObject({ code });
  await sql`rollback to savepoint ${sql.id(name)}`.execute(trx);
}

describe("S3 schema: actions", () => {
  test("applied and undone need applied_at", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      await expectCode(
        trx,
        "applied_without_time",
        () => insertAction(trx, orgId, emailId, { status: "applied" }),
        "23514"
      );
      await insertAction(trx, orgId, emailId, { status: "applied", applied_at: now });
      await expectCode(
        trx,
        "undone_without_time",
        () => insertAction(trx, orgId, emailId, { status: "undone" }),
        "23514"
      );
    });
  });

  test("one original has at most one reverse row; NULL reverses repeat", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      const original = await insertAction(trx, orgId, emailId, { status: "applied", applied_at: now });
      await insertAction(trx, orgId, emailId, { status: "ready", reverses_action_id: original });
      await expectCode(
        trx,
        "second_reverse",
        () => insertAction(trx, orgId, emailId, { status: "ready", reverses_action_id: original }),
        "23505"
      );
      await insertAction(trx, orgId, emailId, { status: "ready" });
      await insertAction(trx, orgId, emailId, { status: "ready" });
    });
  });
});

describe("S3 schema: emails", () => {
  test("a new email has inbox_uid and moved_at NULL", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      const row = await trx
        .selectFrom("emails")
        .select(["inbox_uid", "moved_at"])
        .where("id", "=", emailId)
        .executeTakeFirstOrThrow();
      expect(row.inbox_uid).toBeNull();
      expect(row.moved_at).toBeNull();
    });
  });
});

describe("S3 schema: outbox", () => {
  test("action_failed needs email_id; digest still needs digest_id", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      await insertOutbox(trx, orgId, userId, "action_failed", { email_id: emailId });
      await expectCode(trx, "no_email", () => insertOutbox(trx, orgId, userId, "action_failed", {}), "23514");
      await expectCode(trx, "no_digest", () => insertOutbox(trx, orgId, userId, "digest", {}), "23514");
    });
  });

  test("urgent still needs email_id", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      await expectCode(trx, "urgent_no_email", () => insertOutbox(trx, orgId, userId, "urgent", {}), "23514");
    });
  });
});

describe("S3 schema: indexes", () => {
  test("pg_indexes lists the new indexes", async () => {
    const result = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('emails_claim_idx', 'emails_moved_idx', 'emails_returned_idx', 'actions_email_type_idx', 'actions_reverse_key')
    `.execute(db);
    expect(result.rows.map((r) => r.indexname).sort()).toEqual([
      "actions_email_type_idx",
      "actions_reverse_key",
      "emails_claim_idx",
      "emails_moved_idx",
      "emails_returned_idx",
    ]);
  });
});
