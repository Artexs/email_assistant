import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import { testDb } from "./helpers";

// The contract migration `drop_old_cursor_columns` removed the old names of two `emails` columns and the trigger that
// copied them. This file names the old columns on purpose.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

async function emailsColumns(names: string[]): Promise<string[]> {
  const result = await sql<{ column_name: string }>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'emails' AND column_name = ANY(${names})
    ORDER BY column_name
  `.execute(db);
  return result.rows.map((row) => row.column_name);
}

describe("emails columns after the contract migration", () => {
  test("source_uid and move_pending_at exist", async () => {
    expect(await emailsColumns(["source_uid", "move_pending_at"])).toEqual(["move_pending_at", "source_uid"]);
  });

  test("inbox_uid and undo_pending_at are gone", async () => {
    expect(await emailsColumns(["inbox_uid", "undo_pending_at"])).toEqual([]);
  });

  test("the copy trigger and its function are gone", async () => {
    const trigger = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'emails_copy_renamed_columns'
    `.execute(db);
    const fn = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'emails_copy_renamed_columns'
    `.execute(db);
    expect([trigger.rows[0]?.n, fn.rows[0]?.n]).toEqual([0, 0]);
  });

  test("the old mailbox cursor columns are gone", async () => {
    const result = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'mailboxes' AND column_name IN ('uidvalidity', 'last_uid')
    `.execute(db);
    expect(result.rows).toEqual([]);
  });
});
