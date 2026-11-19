import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import type { Db, DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertDraftAndSend, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopActionPair, insertLoopRow } from "./loops-fixtures";
import { createScratchDb } from "./scratch-db";

// The migration `action_loop_anchor` :
// the second anchor of an action, its CHECKs, composite keys, row-level security, and the Up and Down sections.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const CHECK = "23514";
const FOREIGN_KEY = "23503";

const migration = readFileSync(
  join(import.meta.dir, "../../../../db/migrations/20261115170001_action_loop_anchor.sql"),
  "utf8"
);
const up = migration.split("-- migrate:down")[0] ?? "";
const down = migration.split("-- migrate:down")[1] ?? "";

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

// A Postgres error aborts the transaction: the savepoint lets the test go on after it.
async function expectSqlState(trx: Trx, run: () => Promise<unknown>, code: string): Promise<void> {
  await sql`savepoint f116_anchor_case`.execute(trx);
  let state: string | undefined;
  try {
    await run();
  } catch (error) {
    state = sqlState(error);
  }
  expect(state).toBe(code);
  await sql`rollback to savepoint f116_anchor_case`.execute(trx);
}

interface Rows {
  orgId: string;
  userId: string;
  mailboxId: string;
}

async function insertActionRaw(
  trx: Trx,
  o: { orgId: string },
  values: { email_id?: string | null; loop_id?: string | null; type?: string }
): Promise<string> {
  const row = await trx
    .insertInto("actions")
    .values({
      org_id: o.orgId,
      type: values.type ?? "create_draft",
      status: "ready",
      idempotency_key: `test:${randomUUID()}`,
      email_id: values.email_id ?? null,
      loop_id: values.loop_id ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function insertOutboxRaw(
  trx: Trx,
  o: Rows,
  values: { kind: string; email_id?: string | null; loop_id?: string | null; edit_of_outbox_id?: string | null }
): Promise<string> {
  const at = new Date("2026-11-15T10:00:00Z");
  const row = await trx
    .insertInto("outbox")
    .values({
      org_id: o.orgId,
      user_id: o.userId,
      kind: values.kind,
      dedup_key: `test:${randomUUID()}`,
      text: "x",
      next_attempt_at: at,
      created_at: at,
      email_id: values.email_id ?? null,
      loop_id: values.loop_id ?? null,
      edit_of_outbox_id: values.edit_of_outbox_id ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function scopeLocal(trx: Trx, orgId: string): Promise<void> {
  await sql`select set_config('app.org_id', ${orgId}, true)`.execute(trx);
}

describe("actions.loop_id: the anchor CHECKs", () => {
  test("T2: a row with both anchors null or both set is refused; one anchor is stored", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, o, o.mailboxId);
      const loopId = await insertLoopRow(trx, o, o.mailboxId);
      await expectSqlState(trx, () => insertActionRaw(trx, o, {}), CHECK);
      await expectSqlState(trx, () => insertActionRaw(trx, o, { email_id: emailId, loop_id: loopId }), CHECK);
      const byMail = await insertActionRaw(trx, o, { email_id: emailId });
      const byLoop = await insertActionRaw(trx, o, { loop_id: loopId });
      const rows = await trx
        .selectFrom("actions")
        .select(["id", "email_id", "loop_id"])
        .where("org_id", "=", o.orgId)
        .orderBy("id")
        .execute();
      expect(rows.find((row) => row.id === byMail)).toEqual({ id: byMail, email_id: emailId, loop_id: null });
      expect(rows.find((row) => row.id === byLoop)).toEqual({ id: byLoop, email_id: null, loop_id: loopId });
    });
  });

  test("T3: a loop row is a create_draft or a send; every other type is refused", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const loopId = await insertLoopRow(trx, o, o.mailboxId);
      for (const type of ["move", "mark_read", "flag", "save_summary"]) {
        await expectSqlState(trx, () => insertActionRaw(trx, o, { loop_id: loopId, type }), CHECK);
      }
      await insertActionRaw(trx, o, { loop_id: loopId, type: "create_draft" });
      // A send needs a draft it depends on only when it is `ready`: the pair fixture holds the legal shape.
      const pair = await insertLoopActionPair(trx, o, loopId);
      expect(pair.sendId).toBeString();
    });
  });
});

describe("outbox.loop_id: the mail-kind CHECK", () => {
  test("T3: a card kind needs a mail or a loop; neither is refused, either is stored", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, o, o.mailboxId);
      const loopId = await insertLoopRow(trx, o, o.mailboxId);
      for (const kind of [
        "urgent",
        "action_failed",
        "approval",
        "approval_set",
        "send_result",
        "delegation_answered",
      ]) {
        await expectSqlState(trx, () => insertOutboxRaw(trx, o, { kind }), CHECK);
        await insertOutboxRaw(trx, o, { kind, loop_id: loopId });
        await insertOutboxRaw(trx, o, { kind, email_id: emailId });
      }
      // The kinds that name no mail stay free of both ids.
      await insertOutboxRaw(trx, o, { kind: "not_triaged" });
    });
  });

  test("T3: an approval_edit card needs a mail or a loop", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const loopId = await insertLoopRow(trx, o, o.mailboxId);
      const approval = await insertOutboxRaw(trx, o, { kind: "approval", loop_id: loopId });
      await expectSqlState(
        trx,
        () => insertOutboxRaw(trx, o, { kind: "approval_edit", edit_of_outbox_id: approval }),
        CHECK
      );
      const edit = await insertOutboxRaw(trx, o, {
        kind: "approval_edit",
        loop_id: loopId,
        edit_of_outbox_id: approval,
      });
      expect(edit).toBeString();
    });
  });
});

describe("loop_id: composite keys, cascade and row-level security", () => {
  test("a loop of another organization is refused for an action and for an outbox row", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const loopOfA = await insertLoopRow(trx, a, a.mailboxId);
      await expectSqlState(trx, () => insertActionRaw(trx, b, { loop_id: loopOfA }), FOREIGN_KEY);
      await expectSqlState(trx, () => insertOutboxRaw(trx, b, { kind: "approval", loop_id: loopOfA }), FOREIGN_KEY);
      await insertActionRaw(trx, a, { loop_id: loopOfA });
    });
  });

  test("deleting a loop deletes its actions and outbox rows; the actions of mail stay", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const pair = await insertDraftAndSend(trx, o, o.mailboxId, { createdAt: new Date() });
      const loopId = await insertLoopRow(trx, o, o.mailboxId);
      await insertLoopActionPair(trx, o, loopId);
      await insertOutboxRaw(trx, o, { kind: "approval", loop_id: loopId });
      const count = async (table: "actions" | "outbox", column: "loop_id" | "email_id", id: string) => {
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from ${sql.table(table)} where ${sql.ref(column)} = ${id}::uuid`.execute(trx);
        return rows[0]?.n ?? 0;
      };
      expect(await count("actions", "loop_id", loopId)).toBe(2);
      expect(await count("outbox", "loop_id", loopId)).toBe(1);
      await trx.deleteFrom("open_loops").where("id", "=", loopId).where("org_id", "=", o.orgId).execute();
      expect(await count("actions", "loop_id", loopId)).toBe(0);
      expect(await count("outbox", "loop_id", loopId)).toBe(0);
      expect(await count("actions", "email_id", pair.emailId)).toBe(2);
    });
  });

  test("deleting the mailbox deletes its loops and their actions", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const loopId = await insertLoopRow(trx, o, o.mailboxId);
      await insertLoopActionPair(trx, o, loopId);
      await trx.deleteFrom("mailboxes").where("id", "=", o.mailboxId).where("org_id", "=", o.orgId).execute();
      const { rows } = await sql<{ n: number }>`
        select count(*)::int as n from actions where loop_id = ${loopId}::uuid`.execute(trx);
      expect(rows[0]?.n).toBe(0);
    });
  });

  test("row-level security: the rows of a loop are visible to its organization only", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const loopId = await insertLoopRow(trx, a, a.mailboxId);
      await insertLoopActionPair(trx, a, loopId);
      await insertOutboxRaw(trx, a, { kind: "approval", loop_id: loopId });
      const visible = async () => {
        const actions = await trx.selectFrom("actions").select("id").where("loop_id", "=", loopId).execute();
        const outbox = await trx.selectFrom("outbox").select("id").where("loop_id", "=", loopId).execute();
        return { actions: actions.length, outbox: outbox.length };
      };
      await scopeLocal(trx, b.orgId);
      expect(await visible()).toEqual({ actions: 0, outbox: 0 });
      await scopeLocal(trx, a.orgId);
      expect(await visible()).toEqual({ actions: 2, outbox: 1 });
    });
  });
});

async function columnState(
  trx: Trx
): Promise<{ actionsLoop: number; outboxLoop: number; emailIdRequired: boolean; indexes: number }> {
  const { rows } = await sql<{ actions_loop: number; outbox_loop: number; email_required: boolean; indexes: number }>`
    select
      (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'actions' and column_name = 'loop_id')::int as actions_loop,
      (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'outbox' and column_name = 'loop_id')::int as outbox_loop,
      (select is_nullable = 'NO' from information_schema.columns
        where table_schema = 'public' and table_name = 'actions' and column_name = 'email_id') as email_required,
      (select count(*) from pg_indexes
        where schemaname = 'public' and indexname in ('actions_loop_idx', 'outbox_loop_idx'))::int as indexes`.execute(
    trx
  );
  const row = rows[0];
  if (!row) throw new Error("no schema row");
  return {
    actionsLoop: row.actions_loop,
    outboxLoop: row.outbox_loop,
    emailIdRequired: row.email_required,
    indexes: row.indexes,
  };
}

async function oldRows(trx: Trx, orgId: string): Promise<{ actions: number; outbox: number; emails: number }> {
  const { rows } = await sql<{ actions: number; outbox: number; emails: number }>`
    select
      (select count(*) from actions where org_id = ${orgId}::uuid)::int as actions,
      (select count(*) from outbox where org_id = ${orgId}::uuid)::int as outbox,
      (select count(*) from emails where org_id = ${orgId}::uuid)::int as emails`.execute(trx);
  return rows[0] ?? { actions: -1, outbox: -1, emails: -1 };
}

// The Up and Down sections run inside a transaction (DDL is transactional) as the table owner and roll back, so the
// shared test DB keeps its schema.
describe("migration: Down and Up", () => {
  const WITH_ANCHOR = { actionsLoop: 1, outboxLoop: 1, emailIdRequired: false, indexes: 2 };
  const WITHOUT_ANCHOR = { actionsLoop: 0, outboxLoop: 0, emailIdRequired: true, indexes: 0 };

  async function withOwner(run: (owner: Db) => Promise<void>): Promise<void> {
    const scratch = await createScratchDb();
    const owner = scratch.owner;
    try {
      await run(owner);
    } finally {
      await scratch.drop();
    }
  }

  test("T1: Up only adds; Down removes the new objects, keeps every old row; Up adds them again", async () => {
    expect(up).not.toMatch(/DROP\s+(TABLE|COLUMN)|RENAME|ALTER\s+COLUMN\s+(?!email_id\s+DROP\s+NOT\s+NULL)/i);
    await withOwner(async (owner) => {
      await withRollback(owner, async (trx) => {
        const o = await createOrgWithMailbox(trx);
        const pair = await insertDraftAndSend(trx, o, o.mailboxId, { createdAt: new Date() });
        await insertOutboxRaw(trx, o, { kind: "approval", email_id: pair.emailId });
        expect(await columnState(trx)).toEqual(WITH_ANCHOR);
        const before = await oldRows(trx, o.orgId);
        expect(before).toEqual({ actions: 2, outbox: 1, emails: 1 });

        await sql.raw(down).execute(trx);
        expect(await columnState(trx)).toEqual(WITHOUT_ANCHOR);
        expect(await oldRows(trx, o.orgId)).toEqual(before);
        // The old rule is back: a card with no mail is refused.
        await expectSqlState(
          trx,
          () =>
            sql`insert into outbox (org_id, user_id, kind, dedup_key, text, next_attempt_at, created_at)
              values (${o.orgId}::uuid, ${o.userId}::uuid, 'approval', ${`test:${randomUUID()}`}, 'x', now(), now())`.execute(
              trx
            ),
          CHECK
        );

        await sql.raw(up).execute(trx);
        expect(await columnState(trx)).toEqual(WITH_ANCHOR);
        expect(await oldRows(trx, o.orgId)).toEqual(before);
        const rows = await trx
          .selectFrom("actions")
          .select(["email_id", "loop_id"])
          .where("org_id", "=", o.orgId)
          .execute();
        expect(rows.every((row) => row.email_id === pair.emailId && row.loop_id === null)).toBe(true);
      });
    });
  });

  test("T4: Down fails while an action hangs on a loop, and the row stays", async () => {
    await withOwner(async (owner) => {
      await withRollback(owner, async (trx) => {
        const o = await createOrgWithMailbox(trx);
        const loopId = await insertLoopRow(trx, o, o.mailboxId);
        const pair = await insertLoopActionPair(trx, o, loopId);
        await expectSqlState(trx, () => sql.raw(down).execute(trx), "P0001");
        expect(await columnState(trx)).toEqual(WITH_ANCHOR);
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from actions where id = ${pair.sendId}::uuid and loop_id = ${loopId}::uuid`.execute(
          trx
        );
        expect(rows[0]?.n).toBe(1);
      });
    });
  });

  test("T4: Down fails while an outbox row hangs on a loop", async () => {
    await withOwner(async (owner) => {
      await withRollback(owner, async (trx) => {
        const o = await createOrgWithMailbox(trx);
        const loopId = await insertLoopRow(trx, o, o.mailboxId);
        const outboxId = await insertOutboxRaw(trx, o, { kind: "approval", loop_id: loopId });
        await expectSqlState(trx, () => sql.raw(down).execute(trx), "P0001");
        const { rows } = await sql<{ n: number }>`
          select count(*)::int as n from outbox where id = ${outboxId}::uuid and loop_id = ${loopId}::uuid`.execute(
          trx
        );
        expect(rows[0]?.n).toBe(1);
      });
    });
  });
});
