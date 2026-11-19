import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { suspiciousReasons } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { createScratchDb } from "./scratch-db";

// Constraints and index of the suspicious-mail migration.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const CHECK = "23514";

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

// A Postgres error aborts the transaction: the savepoint lets the test go on after it.
async function expectSqlState(trx: Trx, run: () => Promise<unknown>, code: string): Promise<void> {
  await sql`savepoint f109_case`.execute(trx);
  let state: string | undefined;
  try {
    await run();
  } catch (error) {
    state = sqlState(error);
  }
  expect(state).toBe(code);
  await sql`rollback to savepoint f109_case`.execute(trx);
}

async function triagedRow(trx: Trx, extra: { suspicious_reasons?: string[] }) {
  const o = await createOrgWithMailbox(trx);
  const emailId = await insertTestEmail(trx, o, o.mailboxId);
  const values = {
    org_id: o.orgId,
    email_id: emailId,
    category: "info",
    confidence: 0.9,
    reason_code: "direct_request",
    fields: "{}",
    ...extra,
  };
  return { o, emailId, values };
}

describe("F109 migration: suspicious_reasons", () => {
  test("1: a row without the column gets {}", async () => {
    await withRollback(db, async (trx) => {
      const { values, emailId } = await triagedRow(trx, {});
      await trx.insertInto("triage_results").values(values).execute();
      const row = await trx
        .selectFrom("triage_results")
        .select("suspicious_reasons")
        .where("email_id", "=", emailId)
        .executeTakeFirstOrThrow();
      expect(row.suspicious_reasons).toEqual([]);
    });
  });

  test("2: a known code is ok; an unknown code is a CHECK error; one bad code among good ones fails too", async () => {
    await withRollback(db, async (trx) => {
      const { values, emailId, o } = await triagedRow(trx, { suspicious_reasons: ["lookalike_domain"] });
      await trx.insertInto("triage_results").values(values).execute();
      const row = await trx
        .selectFrom("triage_results")
        .select("suspicious_reasons")
        .where("email_id", "=", emailId)
        .executeTakeFirstOrThrow();
      expect(row.suspicious_reasons).toEqual(["lookalike_domain"]);
      const other = await insertTestEmail(trx, o, o.mailboxId);
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("triage_results")
            .values({ ...values, email_id: other, suspicious_reasons: ["phish"] })
            .execute(),
        CHECK
      );
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("triage_results")
            .values({ ...values, email_id: other, suspicious_reasons: ["auth_fail", "phish"] })
            .execute(),
        CHECK
      );
    });
  });
});

describe("F109 migration: urgency_profile", () => {
  test("3: null and an object are ok; an array and a string are CHECK errors", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await trx.insertInto("mailbox_settings").values({ mailbox_id: o.mailboxId, org_id: o.orgId }).execute();
      const set = (value: string | null) =>
        trx
          .updateTable("mailbox_settings")
          .set({ urgency_profile: value })
          .where("mailbox_id", "=", o.mailboxId)
          .execute();
      const read = async () =>
        (
          await trx
            .selectFrom("mailbox_settings")
            .select("urgency_profile")
            .where("mailbox_id", "=", o.mailboxId)
            .executeTakeFirstOrThrow()
        ).urgency_profile;
      expect(await read()).toBeNull();
      await expectSqlState(trx, () => set("[]"), CHECK);
      await expectSqlState(trx, () => set('"text"'), CHECK);
      await set('{"topics":[],"deadlines":[]}');
      expect(await read()).toEqual({ topics: [], deadlines: [] });
      await set(null);
      expect(await read()).toBeNull();
    });
  });
});

describe("F109 migration: outbox kind", () => {
  test("4: not_triaged is ok; an unknown kind is a CHECK error; the older kinds stay ok", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const insert = (kind: string, mailboxId: string | null = null) =>
        trx
          .insertInto("outbox")
          .values({
            org_id: o.orgId,
            user_id: o.userId,
            kind,
            mailbox_id: mailboxId,
            dedup_key: `test:${randomUUID()}`,
            text: "x",
            next_attempt_at: new Date(),
            created_at: new Date(),
          })
          .execute();
      await insert("not_triaged");
      await insert("weekly_report");
      await insert("host_blocked", o.mailboxId);
      await expectSqlState(trx, () => insert("xyz"), CHECK);
    });
  });
});

const migration = readFileSync(
  join(import.meta.dir, "../../../../db/migrations/20261115120001_suspicious_urgency_sender.sql"),
  "utf8"
);

describe("F109 migration: code and SQL lists", () => {
  test("6: the SQL list of reason codes equals suspiciousReasons, in the same order", () => {
    const up = migration.split("-- migrate:down")[0] ?? "";
    const match = /suspicious_reasons <@ ARRAY\[([^\]]+)\]::text\[\]/.exec(up);
    expect(match).not.toBeNull();
    const codes = [...(match?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(codes).toEqual([...suspiciousReasons]);
  });
});

describe("F109 migration: sender index", () => {
  test("7: pg_indexes holds emails_mailbox_sender_idx on (mailbox_id, from_address_lower, received_at)", async () => {
    const { rows } = await sql<{ indexdef: string }>`
      select indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'emails' and indexname = 'emails_mailbox_sender_idx'`.execute(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain("(mailbox_id, from_address_lower, received_at)");
  });

  // A small test table gives every index the same cost, so a seq scan or the older mailbox index could win the tie
  // The test sets enable_seqscan = off and enable_sort = off and asks for received_at order: only a plan
  // on emails_mailbox_sender_idx reads one sender's mail in that order without a Sort. It runs as the app role, under
  // the tenant policy: `lower(from_address) = $1` could not be an index condition there (lower() is not leakproof),
  // and `from_address_lower = lower($1)` can. The triage read and the review read use this query shape.
  test("7b: as the app role (row-level security) the sender query has the sender index as its Index Cond", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await sql`
        insert into emails (org_id, mailbox_id, dedup_key, thread_key, content_hash, uid, received_at, status, from_address)
        select ${o.orgId}::uuid, ${o.mailboxId}::uuid, 'd:' || n, 't:' || n, 'h' || n, n, now() - n * interval '1 hour',
          'pending', 'Sender' || (n % 40) || '@X.test'
        from generate_series(1, 400) as n`.execute(trx);
      await sql`set local enable_seqscan = off`.execute(trx);
      await sql`set local enable_sort = off`.execute(trx);
      const { rows } = await sql<Record<string, string>>`
        explain select id from emails
        where mailbox_id = ${o.mailboxId}::uuid and from_address_lower = lower(${"Sender7@X.test"}::text)
        order by received_at`.execute(trx);
      const plan = rows.map((row) => Object.values(row)[0]).join("\n");
      expect(plan).toMatch(/Index Scan using emails_mailbox_sender_idx/);
      expect(plan).toMatch(/Index Cond:.*from_address_lower = /);
      // The Filter line, if any, is the tenant policy: the sender column is not in it.
      expect(plan).not.toMatch(/Filter:.*from_address_lower/);
      expect(plan).not.toContain("Sort");
    });
  });

  test("8: from_address_lower follows from_address: insert, update and null", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const id = await insertTestEmail(trx, o, o.mailboxId, { from_address: "Boss@X.TEST" });
      const read = async () =>
        (await trx.selectFrom("emails").select("from_address_lower").where("id", "=", id).executeTakeFirstOrThrow())
          .from_address_lower;
      expect(await read()).toBe("boss@x.test");
      await trx.updateTable("emails").set({ from_address: "Other@Y.Test" }).where("id", "=", id).execute();
      expect(await read()).toBe("other@y.test");
      await trx.updateTable("emails").set({ from_address: null }).where("id", "=", id).execute();
      expect(await read()).toBeNull();
    });
  });
});

// The Down section runs inside a transaction (DDL is transactional) as the table owner and is rolled back, so the
// shared test DB keeps its schema.
describe("F109 migration: Down", () => {
  test("9: Down deletes the not_triaged rows, keeps the other kinds, and drops the column and the index", async () => {
    const scratch = await createScratchDb();
    const owner = scratch.owner;
    try {
      const down = migration.split("-- migrate:down")[1] ?? "";
      expect(down).toContain("DROP COLUMN from_address_lower");
      await withRollback(owner, async (trx) => {
        const o = await createOrgWithMailbox(trx);
        const insert = (kind: string) =>
          trx
            .insertInto("outbox")
            .values({
              org_id: o.orgId,
              user_id: o.userId,
              kind,
              dedup_key: `test:${randomUUID()}`,
              text: "x",
              next_attempt_at: new Date(),
              created_at: new Date(),
            })
            .execute();
        await insert("not_triaged");
        await insert("weekly_report");
        await sql.raw(down).execute(trx);
        const kinds = await trx.selectFrom("outbox").select("kind").where("org_id", "=", o.orgId).execute();
        expect(kinds.map((row) => row.kind)).toEqual(["weekly_report"]);
        const { rows } = await sql<{ n: number }>`
          select (
            (select count(*) from pg_indexes where indexname = 'emails_mailbox_sender_idx')
            + (select count(*) from information_schema.columns
               where table_name in ('emails', 'triage_results', 'mailbox_settings')
                 and column_name in ('from_address_lower', 'suspicious_reasons', 'urgency_profile'))
          )::int as n`.execute(trx);
        expect(rows[0]?.n).toBe(0);
      });
    } finally {
      await scratch.drop();
    }
  });
});
