import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { createDb, type DB } from "../../src/platform/db";
import { checkMigrationSql } from "../../src/scripts/lib/check-migrations-rules";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The migration `20261119100001_dkim_signatures.sql`: the column `email_headers.dkim_signatures` (the signing domain and the
// signed header names of each DKIM-Signature header). The connection is the `app` role; Down and Up run as the owner.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const CHECK = "23514";

const file = readFileSync(
  join(import.meta.dir, "../../../../db/migrations/20261119100001_dkim_signatures.sql"),
  "utf8"
);
const [upPart = "", downPart = ""] = file.split("-- migrate:down");
const up = upPart.replace("-- migrate:up", "");

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

async function insertWith(trx: Trx, value: string | null): Promise<void> {
  const o = await createOrgWithMailbox(trx);
  const emailId = await insertTestEmail(trx, o, o.mailboxId);
  await sql`
    INSERT INTO email_headers (email_id, org_id, dkim_signatures, parts_known, captured_at)
    VALUES (${emailId}, ${o.orgId}, ${value}::jsonb, true, now())`.execute(trx);
}

async function refused(trx: Trx, value: string): Promise<string | undefined> {
  await sql`savepoint dkim_case`.execute(trx);
  let state: string | undefined;
  try {
    await insertWith(trx, value);
  } catch (error) {
    state = sqlState(error);
  }
  await sql`rollback to savepoint dkim_case`.execute(trx);
  return state;
}

describe("email_headers.dkim_signatures", () => {
  test("1: nullable with no default; the INSERT of the previous release (no such column) still works", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, o, o.mailboxId);
      await sql`
        INSERT INTO email_headers (email_id, org_id, list_unsubscribe, has_calendar, attachments, attachment_count, links,
          link_count, parts_known, captured_at)
        VALUES (${emailId}, ${o.orgId}, '<https://u.test/x>', false, '[]', 0, '[]', 0, true, now())`.execute(trx);
      const row = await trx
        .selectFrom("email_headers")
        .select("dkim_signatures")
        .where("email_id", "=", emailId)
        .executeTakeFirstOrThrow();
      expect(row.dkim_signatures).toBeNull();
      const column = await sql<{ is_nullable: string; column_default: string | null; data_type: string }>`
        select is_nullable, column_default, data_type from information_schema.columns
        where table_name = 'email_headers' and column_name = 'dkim_signatures'`.execute(trx);
      expect(column.rows[0]).toEqual({ is_nullable: "YES", column_default: null, data_type: "jsonb" });
    });
  });

  test("2: the CHECK takes null, [] and up to 8 entries; it refuses a non-array, 9 entries and a huge value", async () => {
    await withRollback(db, async (trx) => {
      const entry = { d: "a.example", h: ["from", "list-unsubscribe"] };
      for (const ok of [null, "[]", JSON.stringify(Array.from({ length: 8 }, () => entry))]) await insertWith(trx, ok);
      expect(await refused(trx, JSON.stringify(entry))).toBe(CHECK);
      expect(await refused(trx, '"text"')).toBe(CHECK);
      expect(await refused(trx, JSON.stringify(Array.from({ length: 9 }, () => entry)))).toBe(CHECK);
      const huge = { d: "a.example", h: Array.from({ length: 8000 }, () => "list-unsubscribe") };
      expect(await refused(trx, JSON.stringify([huge]))).toBe(CHECK);
    });
  });
});

describe("the Down and Up sections", () => {
  test("3: Down drops the column and keeps the header rows; Up makes it again with NULL", async () => {
    const url = process.env.MIGRATOR_DATABASE_URL;
    if (!url) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the Down and Up sections");
    const owner = createDb(url);
    try {
      await withRollback(owner, async (trx) => {
        const o = await createOrgWithMailbox(trx);
        const emailId = await insertTestEmail(trx, o, o.mailboxId);
        await sql`
          INSERT INTO email_headers (email_id, org_id, dkim_signatures, parts_known, captured_at)
          VALUES (${emailId}, ${o.orgId}, '[{"d":"a.example","h":["from"]}]'::jsonb, true, now())`.execute(trx);
        const has = async () =>
          (
            await sql<{ n: number }>`
              select count(*)::int as n from information_schema.columns
              where table_name = 'email_headers' and column_name = 'dkim_signatures'`.execute(trx)
          ).rows[0]?.n;
        expect(await has()).toBe(1);
        await sql.raw(downPart).execute(trx);
        expect(await has()).toBe(0);
        expect(
          await trx.selectFrom("email_headers").select("email_id").where("email_id", "=", emailId).execute()
        ).toHaveLength(1);
        await sql.raw(up).execute(trx);
        expect(await has()).toBe(1);
        const again = await trx
          .selectFrom("email_headers")
          .select("dkim_signatures")
          .where("email_id", "=", emailId)
          .executeTakeFirstOrThrow();
        expect(again.dkim_signatures).toBeNull();
      });
    } finally {
      await owner.destroy();
    }
  });
});

describe("the migration file", () => {
  test("4: db:check-migrations finds nothing; expand only: one new nullable column, no data change, no contract line", () => {
    expect(checkMigrationSql(file)).toEqual([]);
    expect(upPart).not.toContain("-- contract:");
    const statements = upPart
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/^\s*(UPDATE|DELETE FROM|INSERT INTO)\b/im);
    expect(statements.match(/ALTER TABLE \w+/g)).toEqual(["ALTER TABLE email_headers"]);
    expect(statements).toContain("ADD COLUMN dkim_signatures jsonb");
  });
});
