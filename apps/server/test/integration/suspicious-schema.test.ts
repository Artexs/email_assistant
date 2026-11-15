import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { suspiciousReasons } from "@ea/core";

import { createDb, type Db, type DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// Constraints and index of the F109 stage 02 migration (spec/features/active/F109-e3b-improve/stages/stage-02-migration.md).
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
  test("7: pg_indexes holds emails_mailbox_sender_idx on (mailbox_id, lower(from_address), received_at)", async () => {
    const { rows } = await sql<{ indexdef: string }>`
      select indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'emails' and indexname = 'emails_mailbox_sender_idx'`.execute(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain("(mailbox_id, lower(from_address), received_at)");
  });

  // Review N19: a small test table gives every index the same cost, so a seq scan or the older mailbox index wins the
  // tie. Seeding 20,000 rows did not change that (checked by hand: the plan stayed on emails_mailbox_hash_idx). The
  // test sets enable_seqscan = off and enable_sort = off and asks for the order the sender index gives: only a plan on
  // emails_mailbox_sender_idx reads one sender's mail in received_at order without a Sort. The query is the shape of
  // stages 03 and 10: lower(from_address) = $1 in one mailbox.
  const explainSender = async (conn: Db): Promise<string> => {
    let plan = "";
    await withRollback(conn, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await sql`
        insert into emails (org_id, mailbox_id, dedup_key, thread_key, content_hash, uid, received_at, status, from_address)
        select ${o.orgId}::uuid, ${o.mailboxId}::uuid, 'd:' || n, 't:' || n, 'h' || n, n, now() - n * interval '1 hour',
          'pending', 'Sender' || (n % 40) || '@X.test'
        from generate_series(1, 400) as n`.execute(trx);
      await sql`set local enable_seqscan = off`.execute(trx);
      await sql`set local enable_sort = off`.execute(trx);
      const { rows } = await sql<Record<string, string>>`
        explain select received_at from emails
        where mailbox_id = ${o.mailboxId}::uuid and lower(from_address) = ${"sender7@x.test"}
        order by received_at desc limit 50`.execute(trx);
      plan = rows.map((row) => Object.values(row)[0]).join("\n");
    });
    return plan;
  };

  test("7b: the table owner (no row-level security) gets a plan on the sender index, with no Sort", async () => {
    const url = process.env.MIGRATOR_DATABASE_URL;
    if (!url) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the plan check");
    const owner = createDb(url);
    try {
      const plan = await explainSender(owner);
      expect(plan).toContain("Index Scan Backward using emails_mailbox_sender_idx");
      expect(plan).toContain("lower(from_address) = 'sender7@x.test'::text");
      expect(plan).not.toContain("Sort");
    } finally {
      await owner.destroy();
    }
  });

  // Known limit, found in F109 stage 02: lower() is not leakproof, so under the tenant policy (role app) Postgres does
  // not use `lower(from_address) = $1` as an index condition. The sender index then serves the mailbox_id prefix only,
  // and the lower() test is a Filter. If this test fails, a later change fixed the limit: update stages 03 and 10.
  test("7c: the app role gets lower(from_address) as a Filter, not as an index condition (row-level security)", async () => {
    const plan = await explainSender(db);
    expect(plan).not.toContain("Index Scan Backward using emails_mailbox_sender_idx");
    expect(plan).toMatch(/Filter:.*lower\(from_address\)/);
  });
});
