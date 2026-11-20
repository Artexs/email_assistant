import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { createDb, type DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The expand migration `emails_neutral_names`: `source_uid` and `move_pending_at` are copies of `inbox_uid` and
// `undo_pending_at`, and a trigger keeps each pair equal for any writer (old release, new release, both in one statement).
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const migration = readFileSync(
  join(import.meta.dir, "../../../../db/migrations/20261119140001_emails_neutral_names.sql"),
  "utf8"
);
const up = migration.split("-- migrate:down")[0] ?? "";
const down = migration.split("-- migrate:down")[1] ?? "";

const T1 = new Date("2026-11-20T10:00:00Z");
const T2 = new Date("2026-11-20T11:00:00Z");

async function setup(trx: Trx): Promise<{ orgId: string; mailboxId: string }> {
  const { orgId, mailboxId } = await createOrgWithMailbox(trx);
  return { orgId, mailboxId };
}

async function readPairs(
  trx: Trx,
  emailId: string
): Promise<{ uids: [number | null, number | null]; at: [Date | null, Date | null] }> {
  const row = await trx
    .selectFrom("emails")
    .select(["inbox_uid", "source_uid", "undo_pending_at", "move_pending_at"])
    .where("id", "=", emailId)
    .executeTakeFirstOrThrow();
  const num = (value: string | number | bigint | null): number | null => (value === null ? null : Number(value));
  return { uids: [num(row.inbox_uid), num(row.source_uid)], at: [row.undo_pending_at, row.move_pending_at] };
}

describe("emails renamed columns trigger", () => {
  test("T1 insert with the old names fills the new names", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await setup(trx);
      const id = await insertTestEmail(trx, { orgId }, mailboxId, { inbox_uid: 41, undo_pending_at: T1 });
      const row = await readPairs(trx, id);
      expect(row.uids).toEqual([41, 41]);
      expect(row.at).toEqual([T1, T1]);
    });
  });

  test("T2 insert with the new names fills the old names", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await setup(trx);
      const id = await insertTestEmail(trx, { orgId }, mailboxId, { source_uid: 42, move_pending_at: T2 });
      const row = await readPairs(trx, id);
      expect(row.uids).toEqual([42, 42]);
      expect(row.at).toEqual([T2, T2]);
    });
  });

  test("T3 update of inbox_uid reaches source_uid", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await setup(trx);
      const id = await insertTestEmail(trx, { orgId }, mailboxId, { inbox_uid: 41 });
      await trx.updateTable("emails").set({ inbox_uid: 77 }).where("id", "=", id).execute();
      expect((await readPairs(trx, id)).uids).toEqual([77, 77]);
    });
  });

  test("T4 update of source_uid reaches inbox_uid", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await setup(trx);
      const id = await insertTestEmail(trx, { orgId }, mailboxId, { source_uid: 42 });
      await trx.updateTable("emails").set({ source_uid: 88 }).where("id", "=", id).execute();
      expect((await readPairs(trx, id)).uids).toEqual([88, 88]);
    });
  });

  test("T4b update of the move time reaches the old name, and the old name reaches the new one", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await setup(trx);
      const id = await insertTestEmail(trx, { orgId }, mailboxId, { move_pending_at: T1 });
      await trx.updateTable("emails").set({ move_pending_at: T2 }).where("id", "=", id).execute();
      expect((await readPairs(trx, id)).at).toEqual([T2, T2]);
      await trx.updateTable("emails").set({ undo_pending_at: T1 }).where("id", "=", id).execute();
      expect((await readPairs(trx, id)).at).toEqual([T1, T1]);
    });
  });

  test("T5 clearing one timestamp clears the other, from either side", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await setup(trx);
      const first = await insertTestEmail(trx, { orgId }, mailboxId, { undo_pending_at: T1, move_pending_at: T1 });
      await trx.updateTable("emails").set({ undo_pending_at: null }).where("id", "=", first).execute();
      expect((await readPairs(trx, first)).at).toEqual([null, null]);
      const second = await insertTestEmail(trx, { orgId }, mailboxId, { undo_pending_at: T1, move_pending_at: T1 });
      await trx.updateTable("emails").set({ move_pending_at: null }).where("id", "=", second).execute();
      expect((await readPairs(trx, second)).at).toEqual([null, null]);
    });
  });

  test("T6 an update of another column changes none of the four values", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await setup(trx);
      const id = await insertTestEmail(trx, { orgId }, mailboxId, { inbox_uid: 41, undo_pending_at: T1 });
      await trx.updateTable("emails").set({ status: "triaged" }).where("id", "=", id).execute();
      const row = await readPairs(trx, id);
      expect(row.uids).toEqual([41, 41]);
      expect(row.at).toEqual([T1, T1]);
    });
  });

  test("T7 insert with two different values: the new name wins", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await setup(trx);
      const id = await insertTestEmail(trx, { orgId }, mailboxId, { source_uid: 5, inbox_uid: 6 });
      expect((await readPairs(trx, id)).uids).toEqual([5, 5]);
    });
  });

  test("T8 update of both names in one statement: the new name wins", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await setup(trx);
      const id = await insertTestEmail(trx, { orgId }, mailboxId, { source_uid: 1 });
      await trx.updateTable("emails").set({ source_uid: 9, inbox_uid: 10 }).where("id", "=", id).execute();
      expect((await readPairs(trx, id)).uids).toEqual([9, 9]);
    });
  });

  test("T9 insert with all four null stays null", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await setup(trx);
      const id = await insertTestEmail(trx, { orgId }, mailboxId);
      const row = await readPairs(trx, id);
      expect(row.uids).toEqual([null, null]);
      expect(row.at).toEqual([null, null]);
    });
  });

  test("the trigger function is not SECURITY DEFINER", async () => {
    const fn = await sql<{ prosecdef: boolean }>`
      SELECT prosecdef FROM pg_proc WHERE proname = 'emails_copy_renamed_columns'
    `.execute(db);
    expect(fn.rows.map((row) => row.prosecdef)).toEqual([false]);
  });

  // The Down and Up sections run as the table owner inside a transaction (DDL is transactional) and roll back.
  test("the up section backfills a row written under the old names, and the down section removes the new objects", async () => {
    const url = process.env.MIGRATOR_DATABASE_URL;
    if (!url) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the Down and Up sections");
    const owner = createDb(url);
    try {
      await withRollback(owner, async (trx) => {
        const { orgId, mailboxId } = await setup(trx);
        await sql.raw(down).execute(trx);
        const columns = await sql<{ n: number }>`
          SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_name = 'emails' AND column_name IN ('source_uid', 'move_pending_at')
        `.execute(trx);
        expect(columns.rows[0]?.n).toBe(0);
        const id = await insertTestEmail(trx, { orgId }, mailboxId, { inbox_uid: 41, undo_pending_at: T1 } as never);
        await sql.raw(up).execute(trx);
        const row = await readPairs(trx, id);
        expect(row.uids).toEqual([41, 41]);
        expect(row.at).toEqual([T1, T1]);
      });
    } finally {
      await owner.destroy();
    }
  });

  test("the up section sets a lock timeout before it changes the table", () => {
    const lock = up.indexOf("SET LOCAL lock_timeout = '10s';");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(up.indexOf("ALTER TABLE emails"));
  });
});
