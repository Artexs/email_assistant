import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { createDb, type DB } from "../../src/platform/db";

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
  extra: { kind: string; email_id?: string; edit_of_outbox_id?: string; mailbox_id?: string }
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

  test("N1: an edit row cannot name a card of another organization, also not as the app role in its own scope", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const emailA = await insertTestEmail(trx, { orgId: a.orgId }, a.mailboxId);
      const emailB = await insertTestEmail(trx, { orgId: b.orgId }, b.mailboxId);
      const cardB = await insertCard(trx, b.orgId, b.userId, { kind: "approval", email_id: emailB });
      await sql`select set_config('app.org_id', ${a.orgId}, true)`.execute(trx);
      // The row-level policy hides the card of B in the scope of A, and the foreign key must still refuse it.
      const seen = await trx.selectFrom("outbox").select("id").where("id", "=", cardB).execute();
      expect(seen).toEqual([]);
      await expectCode(
        trx,
        "foreign_card",
        () => insertCard(trx, a.orgId, a.userId, { kind: "approval_edit", email_id: emailA, edit_of_outbox_id: cardB }),
        "23503"
      );
      const cardA = await insertCard(trx, a.orgId, a.userId, { kind: "approval", email_id: emailA });
      await insertCard(trx, a.orgId, a.userId, { kind: "approval_edit", email_id: emailA, edit_of_outbox_id: cardA });
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

// The Down section runs in a transaction (DDL is transactional) as the table owner and is rolled back, so the shared test
// DB keeps its schema (as the F109 stage 02 test 9).
describe("F102 migration: Down", () => {
  test("TG3: Down deletes the approval_edit rows, keeps the other kinds, and drops the columns and the keys", async () => {
    const url = process.env.MIGRATOR_DATABASE_URL;
    if (!url) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the Down section");
    const owner = createDb(url);
    try {
      const file = readFileSync(
        join(import.meta.dir, "../../../../db/migrations/20261115130001_approval_edit.sql"),
        "utf8"
      );
      const down = file.split("-- migrate:down")[1] ?? "";
      expect(down).toContain("DROP COLUMN edit_of_outbox_id");
      await withRollback(owner, async (trx) => {
        const o = await createOrgWithMailbox(trx);
        const emailId = await insertTestEmail(trx, { orgId: o.orgId }, o.mailboxId);
        const first = await insertAwaitingSend(trx, o.orgId, emailId);
        await insertAwaitingSend(trx, o.orgId, emailId, { supersedes_action_id: first });
        const card = await insertCard(trx, o.orgId, o.userId, { kind: "approval", email_id: emailId });
        await insertCard(trx, o.orgId, o.userId, { kind: "approval_edit", email_id: emailId, edit_of_outbox_id: card });
        await insertCard(trx, o.orgId, o.userId, { kind: "not_triaged" });
        await insertCard(trx, o.orgId, o.userId, { kind: "weekly_report" });
        await sql.raw(down).execute(trx);
        const kinds = await trx
          .selectFrom("outbox")
          .select("kind")
          .where("org_id", "=", o.orgId)
          .orderBy("kind")
          .execute();
        expect(kinds.map((row) => row.kind)).toEqual(["approval", "not_triaged", "weekly_report"]);
        const left = await sql<{ n: number }>`
          select (
            (select count(*) from information_schema.columns
             where (table_name = 'outbox' and column_name = 'edit_of_outbox_id')
                or (table_name = 'actions' and column_name = 'supersedes_action_id'))
            + (select count(*) from pg_indexes where indexname in ('outbox_edit_of_idx', 'actions_supersedes_key'))
            + (select count(*) from pg_constraint
               where conname in ('outbox_id_org_id_key', 'outbox_edit_of_outbox_id_org_id_fkey', 'outbox_approval_edit_check',
                                 'outbox_approval_edit_email_check', 'actions_supersedes_type_check',
                                 'actions_supersedes_action_id_org_id_fkey'))
          )::int as n`.execute(trx);
        expect(left.rows[0]?.n).toBe(0);
        // The old list is back: it refuses the kind that Down removed and accepts the kinds of master.
        await expectCode(trx, "old_list", () => insertCard(trx, o.orgId, o.userId, { kind: "approval_edit" }), "23514");
        await insertCard(trx, o.orgId, o.userId, { kind: "host_blocked", mailbox_id: o.mailboxId });
      });
    } finally {
      await owner.destroy();
    }
  });
});
