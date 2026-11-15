import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertAction, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// F102 stage 06: `actions.supersedes_action_id`, `outbox.edit_of_outbox_id` and the kind `approval_edit`.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-20T13:00:00Z");

// A statement that must fail aborts the transaction: run it in a savepoint and roll back to it.
async function expectCode(trx: Transaction<DB>, name: string, run: () => Promise<unknown>, code: string) {
  await sql`savepoint ${sql.id(name)}`.execute(trx);
  await expect(run()).rejects.toMatchObject({ code });
  await sql`rollback to savepoint ${sql.id(name)}`.execute(trx);
}

async function insertAwaitingSend(
  trx: Transaction<DB>,
  orgId: string,
  emailId: string,
  extra: { supersedes_action_id?: string; type?: string } = {}
): Promise<string> {
  const row = await trx
    .insertInto("actions")
    .values({
      org_id: orgId,
      email_id: emailId,
      type: extra.type ?? "send",
      status: extra.type === undefined || extra.type === "send" ? "awaiting_approval" : "logged",
      idempotency_key: `test:${randomUUID()}`,
      supersedes_action_id: extra.supersedes_action_id ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function insertCard(
  trx: Transaction<DB>,
  orgId: string,
  userId: string,
  extra: { kind: string; email_id?: string; edit_of_outbox_id?: string }
): Promise<string> {
  const row = await trx
    .insertInto("outbox")
    .values({
      org_id: orgId,
      user_id: userId,
      dedup_key: `test:${randomUUID()}`,
      text: "x",
      next_attempt_at: now,
      created_at: now,
      ...extra,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

describe("F102 schema: actions.supersedes_action_id", () => {
  test("T1: a send replaces a send of the same organization once", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      const old = await insertAwaitingSend(trx, orgId, emailId);
      await insertAwaitingSend(trx, orgId, emailId, { supersedes_action_id: old });
      await expectCode(
        trx,
        "second_successor",
        () => insertAwaitingSend(trx, orgId, emailId, { supersedes_action_id: old }),
        "23505"
      );
      // NULL values repeat.
      await insertAwaitingSend(trx, orgId, emailId);
      await insertAwaitingSend(trx, orgId, emailId);
    });
  });

  test("T2: a row of another organization is refused; a move cannot supersede", async () => {
    await withRollback(db, async (trx) => {
      const one = await createOrgWithMailbox(trx);
      const two = await createOrgWithMailbox(trx);
      const emailOne = await insertTestEmail(trx, { orgId: one.orgId }, one.mailboxId);
      const emailTwo = await insertTestEmail(trx, { orgId: two.orgId }, two.mailboxId);
      const foreign = await insertAwaitingSend(trx, two.orgId, emailTwo);
      await expectCode(
        trx,
        "foreign_org",
        () => insertAwaitingSend(trx, one.orgId, emailOne, { supersedes_action_id: foreign }),
        "23503"
      );
      const own = await insertAwaitingSend(trx, one.orgId, emailOne);
      await expectCode(
        trx,
        "move_supersedes",
        () => insertAwaitingSend(trx, one.orgId, emailOne, { type: "move", supersedes_action_id: own }),
        "23514"
      );
      await insertAwaitingSend(trx, one.orgId, emailOne, { type: "create_draft", supersedes_action_id: own });
    });
  });

  test("a row with a successor cannot be deleted", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      const old = await insertAwaitingSend(trx, orgId, emailId);
      await insertAwaitingSend(trx, orgId, emailId, { supersedes_action_id: old });
      await expectCode(
        trx,
        "delete_old",
        () => trx.deleteFrom("actions").where("id", "=", old).where("org_id", "=", orgId).execute(),
        "23503"
      );
    });
  });

  test("the fixture insert leaves the column empty", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      const id = await insertAction(trx, { orgId }, emailId, { type: "move", status: "ready" });
      const row = await trx
        .selectFrom("actions")
        .select("supersedes_action_id")
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row.supersedes_action_id).toBeNull();
    });
  });
});

describe("F102 schema: outbox approval_edit", () => {
  test("T3: an approval_edit row needs edit_of_outbox_id and email_id; other kinds have no edit_of_outbox_id", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      const card = await insertCard(trx, orgId, userId, { kind: "approval", email_id: emailId });
      await insertCard(trx, orgId, userId, { kind: "approval_edit", email_id: emailId, edit_of_outbox_id: card });
      await expectCode(
        trx,
        "no_target",
        () => insertCard(trx, orgId, userId, { kind: "approval_edit", email_id: emailId }),
        "23514"
      );
      await expectCode(
        trx,
        "no_email",
        () => insertCard(trx, orgId, userId, { kind: "approval_edit", edit_of_outbox_id: card }),
        "23514"
      );
      await expectCode(
        trx,
        "approval_with_target",
        () => insertCard(trx, orgId, userId, { kind: "approval", email_id: emailId, edit_of_outbox_id: card }),
        "23514"
      );
    });
  });

  test("T4: deleting the card deletes its approval_edit rows", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      const card = await insertCard(trx, orgId, userId, { kind: "approval", email_id: emailId });
      const other = await insertCard(trx, orgId, userId, { kind: "approval", email_id: emailId });
      await insertCard(trx, orgId, userId, { kind: "approval_edit", email_id: emailId, edit_of_outbox_id: card });
      await insertCard(trx, orgId, userId, { kind: "approval_edit", email_id: emailId, edit_of_outbox_id: other });
      await trx.deleteFrom("outbox").where("id", "=", card).where("org_id", "=", orgId).execute();
      const rows = await trx
        .selectFrom("outbox")
        .select(["kind", "edit_of_outbox_id"])
        .where("org_id", "=", orgId)
        .orderBy("kind")
        .execute();
      expect(rows.map((row) => [row.kind, row.edit_of_outbox_id])).toEqual([
        ["approval", null],
        ["approval_edit", other],
      ]);
    });
  });

  test("the kind list keeps not_triaged and weekly_report", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId } = await createOrgWithMailbox(trx);
      await insertCard(trx, orgId, userId, { kind: "not_triaged" });
      await insertCard(trx, orgId, userId, { kind: "weekly_report" });
      await expectCode(trx, "unknown_kind", () => insertCard(trx, orgId, userId, { kind: "approval_edit2" }), "23514");
    });
  });
});
