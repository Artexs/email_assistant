import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { createDb, type DB } from "../../src/platform/db";
import { checkMigrationSql } from "../../src/scripts/lib/check-migrations-rules";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The migration `20261117140001_unsubscribe_data.sql` (the column `email_headers.list_unsubscribe_post`
// and the table `unsubscribe_requests`). The connection is the `app` role; the Down and Up sections run as the owner.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const CHECK = "23514";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";
const RLS = "42501";

const migrations = join(import.meta.dir, "../../../../db/migrations");
const file = readFileSync(join(migrations, "20261117140001_unsubscribe_data.sql"), "utf8");
const [upPart = "", downPart = ""] = file.split("-- migrate:down");
const up = upPart.replace("-- migrate:up", "");

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

// A Postgres error aborts the transaction: the savepoint lets the test go on after it.
async function expectSqlState(trx: Trx, run: () => Promise<unknown>, code: string): Promise<void> {
  await sql`savepoint f110_s22_case`.execute(trx);
  let state: string | undefined;
  try {
    await run();
  } catch (error) {
    state = sqlState(error);
  }
  expect(state).toBe(code);
  await sql`rollback to savepoint f110_s22_case`.execute(trx);
}

async function scopeLocal(trx: Trx, orgId: string): Promise<void> {
  await sql`select set_config('app.org_id', ${orgId}, true)`.execute(trx);
}

interface Org {
  orgId: string;
  mailboxId: string;
}

const request = (
  trx: Trx,
  o: Org,
  over: Partial<{
    sender_lower: string;
    sender_domain: string;
    method: string;
    status: string;
    code: string | null;
    mailbox_id: string;
    org_id: string;
  }> = {}
) =>
  trx
    .insertInto("unsubscribe_requests")
    .values({
      org_id: o.orgId,
      mailbox_id: o.mailboxId,
      sender_lower: "news@list.test",
      sender_domain: "list.test",
      method: "one_click",
      ...over,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

describe("unsubscribe_requests: constraints", () => {
  test("1: the defaults make a requested row with no code and no finish time", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const { id } = await request(trx, o);
      const row = await trx
        .selectFrom("unsubscribe_requests")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row).toMatchObject({ status: "requested", method: "one_click", code: null, finished_at: null });
      expect(row.created_at).toBeInstanceOf(Date);
    });
  });

  test("2: the method and the status lists refuse an unknown value; every listed status passes", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await expectSqlState(trx, () => request(trx, o, { method: "mailto" }), CHECK);
      await expectSqlState(trx, () => request(trx, o, { status: "sent" }), CHECK);
      for (const [n, status] of ["requested", "done", "failed", "refused"].entries())
        await request(trx, o, { status, sender_lower: `s${n}@list.test` });
    });
  });

  test("3: the code is a short code, never a URL: the listed codes pass; a URL, a host, a path and a long text do not", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      for (const [n, code] of ["http_200", "http_503", "timeout", "private_host", "redirect", "tls", null].entries())
        await request(trx, o, { code, sender_lower: `ok${n}@list.test` });
      const bad = [
        "https://u.list.test/unsub?id=1",
        "u.list.test",
        "/unsub",
        "http:500",
        "HTTP_200",
        "http 200",
        "",
        "x".repeat(41),
      ];
      for (const [n, code] of bad.entries())
        await expectSqlState(trx, () => request(trx, o, { code, sender_lower: `bad${n}@list.test` }), CHECK);
      await request(trx, o, { code: "x".repeat(40), sender_lower: "long@list.test" });
    });
  });

  test("4: the sender and its domain are lower case and agree: the domain is the end of the address", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await expectSqlState(trx, () => request(trx, o, { sender_lower: "News@list.test" }), CHECK);
      await expectSqlState(trx, () => request(trx, o, { sender_domain: "List.test" }), CHECK);
      await expectSqlState(trx, () => request(trx, o, { sender_domain: "other.test" }), CHECK);
      await expectSqlState(trx, () => request(trx, o, { sender_domain: "ist.test" }), CHECK);
      await expectSqlState(trx, () => request(trx, o, { sender_lower: "a", sender_domain: "a" }), CHECK);
      await expectSqlState(
        trx,
        () => request(trx, o, { sender_lower: `${"a".repeat(250)}@l.test`, sender_domain: "l.test" }),
        CHECK
      );
      await request(trx, o, { sender_lower: "a@sub.list.test", sender_domain: "sub.list.test" });
      await request(trx, o, { sender_lower: "b@list.test", sender_domain: "list.test" });
    });
  });

  test("5: one request per sender and mailbox; another sender and another mailbox may repeat the address", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await request(trx, o);
      await expectSqlState(trx, () => request(trx, o), UNIQUE);
      await request(trx, o, { sender_lower: "other@list.test" });
      const second = await createOrgWithMailbox(trx);
      await request(trx, second);
    });
  });

  test("6: the mailbox must belong to the organization of the row; the row goes with its mailbox", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await expectSqlState(trx, () => request(trx, a, { org_id: b.orgId }), FOREIGN_KEY);
      await expectSqlState(trx, () => request(trx, a, { mailbox_id: randomUUID() }), FOREIGN_KEY);
      await request(trx, a);
      await request(trx, b);
      await trx.deleteFrom("mailboxes").where("id", "=", a.mailboxId).execute();
      const left = await trx
        .selectFrom("unsubscribe_requests")
        .select("org_id")
        .where("org_id", "in", [a.orgId, b.orgId])
        .execute();
      expect(left.map((row) => row.org_id)).toEqual([b.orgId]);
    });
  });

  test("7: the table has exactly the unique key and the org index besides the primary key", async () => {
    const { rows } = await sql<{ indexname: string }>`
      select indexname from pg_indexes where tablename = 'unsubscribe_requests' order by indexname`.execute(db);
    expect(rows.map((row) => row.indexname)).toEqual([
      "unsubscribe_requests_mailbox_id_sender_lower_key",
      "unsubscribe_requests_org_idx",
      "unsubscribe_requests_pkey",
    ]);
  });
});

describe("unsubscribe_requests: row-level security", () => {
  test("8: under the scope of organization B, A's requests are not visible, none can be written for A, none can change", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      await request(trx, a, { sender_lower: "secret-of-a@list.test" });
      await request(trx, b);
      await scopeLocal(trx, b.orgId);
      const rows = await trx.selectFrom("unsubscribe_requests").select("org_id").execute();
      expect(rows.map((row) => row.org_id)).toEqual([b.orgId]);
      // No RETURNING: it would also need the SELECT side of the policy, and hide a missing WITH CHECK.
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("unsubscribe_requests")
            .values({
              org_id: a.orgId,
              mailbox_id: a.mailboxId,
              sender_lower: "x@list.test",
              sender_domain: "list.test",
              method: "one_click",
            })
            .execute(),
        RLS
      );
      const changed = await trx
        .updateTable("unsubscribe_requests")
        .set({ status: "done" })
        .where("org_id", "=", a.orgId)
        .executeTakeFirst();
      expect(changed.numUpdatedRows).toBe(0n);
      const deleted = await trx.deleteFrom("unsubscribe_requests").where("org_id", "=", a.orgId).executeTakeFirst();
      expect(deleted.numDeletedRows).toBe(0n);
    });
  });

  test("9: the table has row-level security on, the one tenant policy, and the app role may use it", async () => {
    const policy = await sql<{ policyname: string; roles: string[]; qual: string; with_check: string }>`
      select policyname, roles::text[] as roles, qual, with_check from pg_policies where tablename = 'unsubscribe_requests'`.execute(
      db
    );
    expect(policy.rows).toHaveLength(1);
    expect(policy.rows[0]).toMatchObject({
      policyname: "tenant_rows",
      roles: ["app"],
      qual: "((app_current_org() IS NULL) OR (org_id = app_current_org()))",
    });
    const flags = await sql<{ rls: boolean; privs: string }>`
      select c.relrowsecurity as rls,
        (select string_agg(p, ',' order by p) from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
          where has_table_privilege('app', c.oid, p)) as privs
      from pg_class c where c.relname = 'unsubscribe_requests'`.execute(db);
    expect(flags.rows[0]).toEqual({ rls: true, privs: "DELETE,INSERT,SELECT,UPDATE" });
  });
});

describe("email_headers.list_unsubscribe_post and the previous release", () => {
  test("10: the column is nullable with no default; the INSERT of the previous release (no such column) still works", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, o, o.mailboxId);
      // The statement of the code before the unsubscribe-post column: it names no `list_unsubscribe_post`.
      await sql`
        INSERT INTO email_headers (email_id, org_id, from_name, reply_to, auth_results, list_unsubscribe, list_id,
          has_calendar, attachments, attachment_count, links, link_count, parts_known, captured_at)
        VALUES (${emailId}, ${o.orgId}, null, '{}', null, '<https://u.test/x>', null, false, '[]', 0, '[]', 0, true, now())`.execute(
        trx
      );
      const row = await trx
        .selectFrom("email_headers")
        .select("list_unsubscribe_post")
        .where("email_id", "=", emailId)
        .executeTakeFirstOrThrow();
      expect(row.list_unsubscribe_post).toBeNull();
      const column = await sql<{ is_nullable: string; column_default: string | null; data_type: string }>`
        select is_nullable, column_default, data_type from information_schema.columns
        where table_name = 'email_headers' and column_name = 'list_unsubscribe_post'`.execute(trx);
      expect(column.rows[0]).toEqual({ is_nullable: "YES", column_default: null, data_type: "boolean" });
    });
  });
});

describe("the Down and Up sections", () => {
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

  const present = async (trx: Trx) => {
    const { rows } = await sql<{ tables: number; columns: number }>`
      select
        (select count(*)::int from pg_tables where schemaname = 'public' and tablename = 'unsubscribe_requests') as tables,
        (select count(*)::int from information_schema.columns
          where table_name = 'email_headers' and column_name = 'list_unsubscribe_post') as columns`.execute(trx);
    return rows[0];
  };

  test("11: Down drops the table and the column and keeps the header rows; Up makes them again", async () => {
    await withOwner(async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, o, o.mailboxId);
      await trx
        .insertInto("email_headers")
        .values({
          email_id: emailId,
          org_id: o.orgId,
          list_unsubscribe_post: true,
          parts_known: true,
          captured_at: new Date(),
        })
        .execute();
      await request(trx, o);
      expect(await present(trx)).toEqual({ tables: 1, columns: 1 });

      await sql.raw(downPart).execute(trx);
      expect(await present(trx)).toEqual({ tables: 0, columns: 0 });
      const kept = await trx.selectFrom("email_headers").select("email_id").where("email_id", "=", emailId).execute();
      expect(kept).toHaveLength(1);

      await sql.raw(up).execute(trx);
      expect(await present(trx)).toEqual({ tables: 1, columns: 1 });
      const again = await trx
        .selectFrom("email_headers")
        .select("list_unsubscribe_post")
        .where("email_id", "=", emailId)
        .executeTakeFirstOrThrow();
      expect(again.list_unsubscribe_post).toBeNull();
      await request(trx, o);
    });
  });
});

describe("the migration file", () => {
  test("12: db:check-migrations finds nothing in the file; the file has no contract line and no data change", () => {
    expect(checkMigrationSql(file)).toEqual([]);
    expect(upPart).not.toContain("-- contract:");
    const statements = upPart
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    // Expand only: no UPDATE or DELETE of old rows, no change of an old table beyond the one new nullable column.
    expect(statements).not.toMatch(/^\s*(UPDATE|DELETE FROM|INSERT INTO)\b/im);
    expect(statements.match(/ALTER TABLE (?!unsubscribe_requests)\w+/g)).toEqual(["ALTER TABLE email_headers"]);
    expect(statements).toContain("ADD COLUMN list_unsubscribe_post boolean;");
  });
});
