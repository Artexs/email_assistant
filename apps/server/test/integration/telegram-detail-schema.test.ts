import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { insertMembership } from "../../src/modules/tenancy/repo";
import { createDb, type DB } from "../../src/platform/db";
import { checkMigrationSql } from "../../src/scripts/lib/check-migrations-rules";

import { addMember, createOrgWithMailbox, linkChat, randomChatId } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The migration `20261119130001_telegram_detail.sql` (the column `memberships.telegram_detail`, the column
// `organizations.telegram_minimal_locked` and the wider list of `outbox_detail_check`). The connection is the `app` role; the Down and
// Up sections run as the owner.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const CHECK = "23514";

const file = readFileSync(
  join(import.meta.dir, "../../../../db/migrations/20261119130001_telegram_detail.sql"),
  "utf8"
);
const [upPart = "", downPart = ""] = file.split("-- migrate:down");
const up = upPart.replace("-- migrate:up", "");

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

// A Postgres error aborts the transaction: the savepoint lets the test go on after it.
async function expectSqlState(trx: Trx, run: () => Promise<unknown>, code: string): Promise<void> {
  await sql`savepoint f118_s10_case`.execute(trx);
  let state: string | undefined;
  try {
    await run();
  } catch (error) {
    state = sqlState(error);
  }
  expect(state).toBe(code);
  await sql`rollback to savepoint f118_s10_case`.execute(trx);
}

async function withOwner(run: (trx: Trx) => Promise<void>): Promise<void> {
  const url = process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the Down and Up sections");
  const owner = createDb(url);
  try {
    await withRollback(owner, run);
  } finally {
    await owner.destroy();
  }
}

const detailOf = async (trx: Trx, orgId: string, userId: string): Promise<string | undefined> => {
  const { rows } = await sql<{ telegram_detail: string }>`
    select telegram_detail from memberships where org_id = ${orgId}::uuid and user_id = ${userId}::uuid`.execute(trx);
  return rows[0]?.telegram_detail;
};

async function outboxRow(
  trx: Trx,
  o: { orgId: string; userId: string; mailboxId: string },
  detail?: string
): Promise<string> {
  const row = await trx
    .insertInto("outbox")
    .values({
      org_id: o.orgId,
      user_id: o.userId,
      kind: "sync_ok",
      mailbox_id: o.mailboxId,
      dedup_key: randomUUID(),
      status: "pending",
      next_attempt_at: new Date(),
      created_at: new Date(),
      ...(detail === undefined ? {} : { detail }),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

describe("memberships.telegram_detail", () => {
  test("1. Up: a member with a chat link before the migration reads full, one without a link reads minimal, a new member reads minimal", async () => {
    await withOwner(async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const ctx = { orgId: o.orgId };
      const linked = o.userId;
      const unlinked = await addMember(trx, o.orgId);
      await linkChat(trx, ctx, linked, randomChatId(), new Date());
      // The state before the migration: Down drops the column, the links stay.
      await sql.raw(downPart).execute(trx);
      const missing = await sql`select 1 from information_schema.columns
        where table_name = 'memberships' and column_name = 'telegram_detail'`.execute(trx);
      expect(missing.rows).toHaveLength(0);

      await sql.raw(up).execute(trx);
      expect(await detailOf(trx, o.orgId, linked)).toBe("full");
      expect(await detailOf(trx, o.orgId, unlinked)).toBe("minimal");
      const added = await addMember(trx, o.orgId);
      expect(await detailOf(trx, o.orgId, added)).toBe("minimal");
      // The CHECK that Up made refuses a level that is not on the list.
      await expectSqlState(
        trx,
        () =>
          sql`update memberships set telegram_detail = 'short' where org_id = ${o.orgId}::uuid and user_id = ${added}::uuid`.execute(
            trx
          ),
        CHECK
      );
    });
  });

  test("1b. Up matches the link by organization: one user linked in one organization is full there and minimal in the other", async () => {
    await withOwner(async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await insertMembership(trx, { orgId: b.orgId }, { userId: a.userId, role: "assistant" });
      await linkChat(trx, { orgId: a.orgId }, a.userId, randomChatId(), new Date());
      await sql.raw(downPart).execute(trx);
      await sql.raw(up).execute(trx);
      expect(await detailOf(trx, a.orgId, a.userId)).toBe("full");
      expect(await detailOf(trx, b.orgId, a.userId)).toBe("minimal");
      expect(await detailOf(trx, b.orgId, b.userId)).toBe("minimal");
    });
  });

  test("2. a level other than full or minimal fails the CHECK", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await expectSqlState(
        trx,
        () =>
          sql`update memberships set telegram_detail = 'short' where org_id = ${o.orgId}::uuid and user_id = ${o.userId}::uuid`.execute(
            trx
          ),
        CHECK
      );
      await expectSqlState(
        trx,
        () =>
          sql`update memberships set telegram_detail = null where org_id = ${o.orgId}::uuid and user_id = ${o.userId}::uuid`.execute(
            trx
          ),
        "23502"
      );
      await sql`update memberships set telegram_detail = 'full' where org_id = ${o.orgId}::uuid and user_id = ${o.userId}::uuid`.execute(
        trx
      );
      expect(await detailOf(trx, o.orgId, o.userId)).toBe("full");
    });
  });
});

describe("organizations.telegram_minimal_locked", () => {
  test("3. a new organization is not locked; the column is a boolean that cannot be null", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const { rows } = await sql<{ telegram_minimal_locked: boolean }>`
        select telegram_minimal_locked from organizations where id = ${o.orgId}::uuid`.execute(trx);
      expect(rows[0]?.telegram_minimal_locked).toBe(false);
      await expectSqlState(
        trx,
        () => sql`update organizations set telegram_minimal_locked = null where id = ${o.orgId}::uuid`.execute(trx),
        "23502"
      );
    });
  });
});

describe("outbox.detail", () => {
  test("4. the list takes full and minimal and refuses another value; a row with no level reads full (the previous release)", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const bare = await outboxRow(trx, o);
      const minimal = await outboxRow(trx, o, "minimal");
      const { rows } = await sql<{ id: string; detail: string }>`
        select id, detail from outbox where id in (${bare}::uuid, ${minimal}::uuid)`.execute(trx);
      expect(Object.fromEntries(rows.map((row) => [row.id, row.detail]))).toEqual({
        [bare]: "full",
        [minimal]: "minimal",
      });
      await expectSqlState(trx, () => outboxRow(trx, o, "short"), CHECK);
    });
  });
});

describe("the Down and Up sections", () => {
  test("5. Down relabels minimal rows to full, restores the old list and drops both columns; Up makes them again", async () => {
    await withOwner(async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const minimalRow = await outboxRow(trx, o, "minimal");
      const fullRow = await outboxRow(trx, o, "full");
      await sql`update memberships set telegram_detail = 'full' where org_id = ${o.orgId}::uuid and user_id = ${o.userId}::uuid`.execute(
        trx
      );
      await sql`update organizations set telegram_minimal_locked = true where id = ${o.orgId}::uuid`.execute(trx);

      await sql.raw(downPart).execute(trx);
      const columns = await sql<{ column_name: string }>`
        select column_name from information_schema.columns
        where (table_name = 'memberships' and column_name = 'telegram_detail')
           or (table_name = 'organizations' and column_name = 'telegram_minimal_locked')`.execute(trx);
      expect(columns.rows).toEqual([]);
      const rows = await sql<{ id: string; detail: string }>`
        select id, detail from outbox where id in (${minimalRow}::uuid, ${fullRow}::uuid)`.execute(trx);
      expect(rows.rows.map((row) => row.detail)).toEqual(["full", "full"]);
      // The old list refuses `minimal` again.
      await expectSqlState(trx, () => outboxRow(trx, o, "minimal"), CHECK);

      await sql.raw(up).execute(trx);
      // The owner of the test org has no chat link: minimal; the lock is off.
      expect(await detailOf(trx, o.orgId, o.userId)).toBe("minimal");
      const lock = await sql<{ telegram_minimal_locked: boolean }>`
        select telegram_minimal_locked from organizations where id = ${o.orgId}::uuid`.execute(trx);
      expect(lock.rows[0]?.telegram_minimal_locked).toBe(false);
      await outboxRow(trx, o, "minimal");
    });
  });

  test("6. a second Down and Up gives the same member levels from the same links", async () => {
    await withOwner(async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await linkChat(trx, { orgId: o.orgId }, o.userId, randomChatId(), new Date());
      const other = await addMember(trx, o.orgId);
      const levels = async () => [await detailOf(trx, o.orgId, o.userId), await detailOf(trx, o.orgId, other)];
      await sql.raw(downPart).execute(trx);
      await sql.raw(up).execute(trx);
      const first = await levels();
      await sql.raw(downPart).execute(trx);
      await sql.raw(up).execute(trx);
      expect(await levels()).toEqual(first);
      expect(first).toEqual(["full", "minimal"]);
    });
  });
});

describe("the migration file", () => {
  test("7. the contract check reads no finding and the file carries no contract mark (nothing is dropped or narrowed)", () => {
    expect(checkMigrationSql(file)).toEqual([]);
    expect(file).not.toMatch(/^-- contract:/m);
    // The only drop in the Up part is the replaced list of `outbox_detail_check`, and the new list holds the old one.
    const statements = upPart
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect([...statements.matchAll(/\bDROP\s+\w+(?:\s+\w+)?\s+(\w+)/g)].map((match) => match[1])).toEqual([
      "outbox_detail_check",
    ]);
    expect(statements).toContain("CHECK (detail IN ('full', 'minimal'))");
  });
});
