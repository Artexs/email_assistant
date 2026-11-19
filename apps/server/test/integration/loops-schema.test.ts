import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import { createDb, type DB } from "../../src/platform/db";

import {
  createOrgWithMailbox,
  insertDelegate,
  insertDelegation,
  insertDraftAndSend,
  insertTestEmail,
} from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertAnalysisRow, insertLoopRow, insertSentRow } from "./loops-fixtures";

// Constraints, keys, row-level security and the Down section of the loops migration
// (`docs/capabilities/open-loops.md`).
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const CHECK = "23514";
const NOT_NULL = "23502";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";
const RLS = "42501";

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

// A Postgres error aborts the transaction: the savepoint lets the test go on after it.
async function expectSqlState(trx: Trx, run: () => Promise<unknown>, code: string): Promise<void> {
  await sql`savepoint f116_case`.execute(trx);
  let state: string | undefined;
  try {
    await run();
  } catch (error) {
    state = sqlState(error);
  }
  expect(state).toBe(code);
  await sql`rollback to savepoint f116_case`.execute(trx);
}

async function scopeLocal(trx: Trx, orgId: string): Promise<void> {
  await sql`select set_config('app.org_id', ${orgId}, true)`.execute(trx);
}

async function count(trx: Trx, table: "open_loops" | "sent_analyses", column: string, id: string): Promise<number> {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from ${sql.table(table)} where ${sql.ref(column)} = ${id}::uuid`.execute(trx);
  return rows[0]?.n ?? 0;
}

describe("open_loops: CHECK constraints", () => {
  test("2: a waiting or promised loop with a delegate, and a delegated loop without one, are refused", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const delegateId = await insertDelegate(trx, o);
      await expectSqlState(
        trx,
        () => insertLoopRow(trx, o, o.mailboxId, { kind: "waiting", delegate_id: delegateId }),
        CHECK
      );
      await expectSqlState(
        trx,
        () => insertLoopRow(trx, o, o.mailboxId, { kind: "promised", delegate_id: delegateId }),
        CHECK
      );
      await expectSqlState(
        trx,
        () => insertLoopRow(trx, o, o.mailboxId, { kind: "delegated", delegate_id: null }),
        CHECK
      );
      const id = await insertLoopRow(trx, o, o.mailboxId, { kind: "delegated", delegate_id: delegateId });
      expect(await count(trx, "open_loops", "id", id)).toBe(1);
    });
  });

  test("3: a closed loop needs closed_at and close_reason; an open loop has neither", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const closedAt = new Date("2026-11-15T10:00:00Z");
      await expectSqlState(
        trx,
        () => insertLoopRow(trx, o, o.mailboxId, { status: "closed", closed_at: closedAt }),
        CHECK
      );
      await expectSqlState(
        trx,
        () => insertLoopRow(trx, o, o.mailboxId, { status: "closed", close_reason: "done" }),
        CHECK
      );
      await expectSqlState(
        trx,
        () => insertLoopRow(trx, o, o.mailboxId, { status: "open", closed_at: closedAt }),
        CHECK
      );
      await expectSqlState(
        trx,
        () => insertLoopRow(trx, o, o.mailboxId, { status: "open", close_reason: "done" }),
        CHECK
      );
      await expectSqlState(
        trx,
        () => insertLoopRow(trx, o, o.mailboxId, { status: "closed", closed_at: closedAt, close_reason: "later" }),
        CHECK
      );
      const id = await insertLoopRow(trx, o, o.mailboxId, {
        status: "closed",
        closed_at: closedAt,
        close_reason: "done",
      });
      expect(await count(trx, "open_loops", "id", id)).toBe(1);
    });
  });

  test("3b: the code lists, the counters, the recipient total and the text lengths", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const bad: Record<string, Parameters<typeof insertLoopRow>[3]> = {
        kind: { kind: "snoozed" },
        status: { status: "paused" },
        language: { language: "de" },
        due_source: { due_source: "guess" },
        later_count_high: { later_count: 4 },
        later_count_low: { later_count: -1 },
        follow_ups_high: { follow_ups_sent: 3 },
        recipients_11: {
          to_addresses: Array.from({ length: 6 }, (_, n) => `a${n}@x.test`),
          cc_addresses: Array.from({ length: 5 }, (_, n) => `c${n}@x.test`),
        },
        text_81: { text: "x".repeat(81) },
        subject_301: { subject: "x".repeat(301) },
      };
      for (const overrides of Object.values(bad)) {
        await expectSqlState(trx, () => insertLoopRow(trx, o, o.mailboxId, overrides), CHECK);
      }
      await expectSqlState(
        trx,
        () => insertLoopRow(trx, o, o.mailboxId, { due_at: null as unknown as Date }),
        NOT_NULL
      );
      const ok = await insertLoopRow(trx, o, o.mailboxId, {
        later_count: 3,
        follow_ups_sent: 2,
        to_addresses: Array.from({ length: 6 }, (_, n) => `a${n}@x.test`),
        cc_addresses: Array.from({ length: 4 }, (_, n) => `c${n}@x.test`),
        text: "x".repeat(80),
        subject: "y".repeat(300),
      });
      expect(await count(trx, "open_loops", "id", ok)).toBe(1);
      // Text and subject may be cleared (retention, switch off, erase).
      const cleared = await insertLoopRow(trx, o, o.mailboxId, {
        text: null,
        subject: null,
        counterpart: null,
        to_addresses: [],
      });
      expect(await count(trx, "open_loops", "id", cleared)).toBe(1);
    });
  });

  test("3c: every close reason of the interface list is accepted", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const reasons = [
        "replied",
        "replied_subject",
        "done",
        "dropped",
        "untracked",
        "stale",
        "later_reply",
        "expired",
        "sent_off",
      ];
      for (const reason of reasons) {
        await insertLoopRow(trx, o, o.mailboxId, { status: "closed", closed_at: new Date(), close_reason: reason });
      }
      expect(await count(trx, "open_loops", "mailbox_id", o.mailboxId)).toBe(reasons.length);
    });
  });
});

describe("open_loops: keys", () => {
  test("4: deleting the sent row keeps the loop and clears both sent ids, not org_id", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const first = await insertSentRow(trx, o, o.mailboxId);
      const second = await insertSentRow(trx, o, o.mailboxId);
      const id = await insertLoopRow(trx, o, o.mailboxId, { sent_email_id: first, last_sent_email_id: second });
      await insertAnalysisRow(trx, o, o.mailboxId, first);
      await trx.deleteFrom("sent_emails").where("id", "=", first).execute();
      const row = await trx.selectFrom("open_loops").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      expect(row.sent_email_id).toBeNull();
      expect(row.last_sent_email_id).toBe(second);
      expect(row.org_id).toBe(o.orgId);
      // The analysis of the deleted sent row goes with it.
      expect(await count(trx, "sent_analyses", "sent_email_id", first)).toBe(0);
      await trx.deleteFrom("sent_emails").where("id", "=", second).execute();
      const after = await trx.selectFrom("open_loops").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      expect(after.last_sent_email_id).toBeNull();
    });
  });

  test("4b: deleting the closing email keeps the loop and clears closed_by_email_id", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, o, o.mailboxId);
      const id = await insertLoopRow(trx, o, o.mailboxId, {
        status: "closed",
        closed_at: new Date(),
        close_reason: "replied",
        closed_by_email_id: emailId,
      });
      await trx.deleteFrom("emails").where("id", "=", emailId).execute();
      const row = await trx.selectFrom("open_loops").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      expect(row.closed_by_email_id).toBeNull();
      expect(row.status).toBe("closed");
    });
  });

  test("5: deleting the mailbox removes its loops and analyses, and only its own", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const sentA = await insertSentRow(trx, a, a.mailboxId);
      const sentB = await insertSentRow(trx, b, b.mailboxId);
      await insertLoopRow(trx, a, a.mailboxId, { sent_email_id: sentA });
      await insertLoopRow(trx, a, a.mailboxId);
      await insertAnalysisRow(trx, a, a.mailboxId, sentA);
      await insertLoopRow(trx, b, b.mailboxId, { sent_email_id: sentB });
      await insertAnalysisRow(trx, b, b.mailboxId, sentB);
      await scopeLocal(trx, a.orgId);
      await sql`select delete_mailbox(${a.orgId}::uuid, ${a.mailboxId}::uuid)`.execute(trx);
      await scopeLocal(trx, "");
      expect(await count(trx, "open_loops", "mailbox_id", a.mailboxId)).toBe(0);
      expect(await count(trx, "sent_analyses", "mailbox_id", a.mailboxId)).toBe(0);
      expect(await count(trx, "open_loops", "mailbox_id", b.mailboxId)).toBe(1);
      expect(await count(trx, "sent_analyses", "mailbox_id", b.mailboxId)).toBe(1);
    });
  });

  test("6: one loop per (org, sent mail, kind); other kinds and loops without a sent mail do not collide", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const sentId = await insertSentRow(trx, o, o.mailboxId);
      await insertLoopRow(trx, o, o.mailboxId, { sent_email_id: sentId, kind: "waiting" });
      await expectSqlState(
        trx,
        () => insertLoopRow(trx, o, o.mailboxId, { sent_email_id: sentId, kind: "waiting" }),
        UNIQUE
      );
      await insertLoopRow(trx, o, o.mailboxId, { sent_email_id: sentId, kind: "promised" });
      await insertLoopRow(trx, o, o.mailboxId, { sent_email_id: null });
      await insertLoopRow(trx, o, o.mailboxId, { sent_email_id: null });
      expect(await count(trx, "open_loops", "mailbox_id", o.mailboxId)).toBe(4);
    });
  });

  test("6b: composite keys: a loop cannot point at a row of another organization", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const sentB = await insertSentRow(trx, b, b.mailboxId);
      const delegateB = await insertDelegate(trx, b);
      const emailB = await insertTestEmail(trx, b, b.mailboxId);
      await expectSqlState(trx, () => insertLoopRow(trx, a, b.mailboxId), FOREIGN_KEY);
      await expectSqlState(trx, () => insertLoopRow(trx, a, a.mailboxId, { sent_email_id: sentB }), FOREIGN_KEY);
      await expectSqlState(trx, () => insertLoopRow(trx, a, a.mailboxId, { last_sent_email_id: sentB }), FOREIGN_KEY);
      await expectSqlState(
        trx,
        () => insertLoopRow(trx, a, a.mailboxId, { kind: "delegated", delegate_id: delegateB }),
        FOREIGN_KEY
      );
      await expectSqlState(
        trx,
        () =>
          insertLoopRow(trx, a, a.mailboxId, {
            status: "closed",
            closed_at: new Date(),
            close_reason: "replied",
            closed_by_email_id: emailB,
          }),
        FOREIGN_KEY
      );
      await expectSqlState(trx, () => insertAnalysisRow(trx, a, a.mailboxId, sentB), FOREIGN_KEY);
      await expectSqlState(trx, () => insertAnalysisRow(trx, a, b.mailboxId, sentB), FOREIGN_KEY);
    });
  });

  test("6c: the delegate stays: a loop blocks the delete of its delegate", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const delegateId = await insertDelegate(trx, o);
      await insertLoopRow(trx, o, o.mailboxId, { kind: "delegated", delegate_id: delegateId });
      await expectSqlState(trx, () => trx.deleteFrom("delegates").where("id", "=", delegateId).execute(), FOREIGN_KEY);
    });
  });
});

describe("sent_analyses", () => {
  test("6d: status and skip_reason lists; attempts is not negative; one row per sent mail", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const sentId = await insertSentRow(trx, o, o.mailboxId);
      await expectSqlState(trx, () => insertAnalysisRow(trx, o, o.mailboxId, sentId, { status: "waiting" }), CHECK);
      await expectSqlState(
        trx,
        () => insertAnalysisRow(trx, o, o.mailboxId, sentId, { status: "skipped", skip_reason: "boring" }),
        CHECK
      );
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("sent_analyses")
            .values({
              org_id: o.orgId,
              mailbox_id: o.mailboxId,
              sent_email_id: sentId,
              status: "pending",
              attempts: -1,
            })
            .execute(),
        CHECK
      );
      for (const reason of [
        "own_only",
        "system_draft",
        "list",
        "auto",
        "calendar",
        "too_many",
        "no_text",
        "too_old",
        "thread_restart",
        "delegation_thread",
        "llm_cap",
      ]) {
        const id = await insertSentRow(trx, o, o.mailboxId);
        await insertAnalysisRow(trx, o, o.mailboxId, id, { status: "skipped", skip_reason: reason });
      }
      await insertAnalysisRow(trx, o, o.mailboxId, sentId, { status: "pending" });
      await expectSqlState(trx, () => insertAnalysisRow(trx, o, o.mailboxId, sentId), UNIQUE);
    });
  });
});

describe("row-level security", () => {
  test("7: a row of organization B is not visible, and not writable, in the transaction of organization A", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const b = await createOrgWithMailbox(trx);
      const sentA = await insertSentRow(trx, a, a.mailboxId);
      const sentB = await insertSentRow(trx, b, b.mailboxId);
      const loopA = await insertLoopRow(trx, a, a.mailboxId);
      const loopB = await insertLoopRow(trx, b, b.mailboxId);
      await insertAnalysisRow(trx, a, a.mailboxId, sentA);
      await insertAnalysisRow(trx, b, b.mailboxId, sentB);

      await scopeLocal(trx, a.orgId);
      const loops = await trx.selectFrom("open_loops").select(["id", "org_id"]).execute();
      expect(loops.map((row) => row.id).sort()).toEqual([loopA].sort());
      const analyses = await trx.selectFrom("sent_analyses").select("sent_email_id").execute();
      expect(analyses.map((row) => row.sent_email_id)).toEqual([sentA]);
      // No filter by org_id in these statements: the policy alone keeps organization B out.
      const touched = await trx
        .updateTable("open_loops")
        .set({ text: "changed" })
        .where("id", "=", loopB)
        .executeTakeFirst();
      expect(Number(touched.numUpdatedRows)).toBe(0);
      const removed = await trx.deleteFrom("open_loops").where("id", "=", loopB).executeTakeFirst();
      expect(Number(removed.numDeletedRows)).toBe(0);
      await expectSqlState(trx, () => insertLoopRow(trx, b, b.mailboxId), RLS);
      await expectSqlState(trx, () => insertAnalysisRow(trx, b, b.mailboxId, sentB, { status: "failed" }), RLS);
      // The policy also refuses to move an own row to another organization.
      await expectSqlState(
        trx,
        () => trx.updateTable("open_loops").set({ org_id: b.orgId }).where("id", "=", loopA).execute(),
        RLS
      );

      // Both tables have the policy.
      await scopeLocal(trx, "");
      const { rows } = await sql<{ tablename: string; policyname: string }>`
        select tablename, policyname from pg_policies
        where schemaname = 'public' and tablename in ('open_loops', 'sent_analyses') order by 1`.execute(trx);
      expect(rows).toEqual([
        { tablename: "open_loops", policyname: "tenant_rows" },
        { tablename: "sent_analyses", policyname: "tenant_rows" },
      ]);
    });
  });
});

describe("the other additions", () => {
  test("8: delegations.source defaults to triage", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const pair = await insertDraftAndSend(trx, o, o.mailboxId, { createdAt: new Date() });
      const delegateId = await insertDelegate(trx, o);
      await insertDelegation(trx, o, {
        mailboxId: o.mailboxId,
        emailId: pair.emailId,
        delegateId,
        draftActionId: pair.draftId,
        sendActionId: pair.sendId,
      });
      const row = await trx
        .selectFrom("delegations")
        .select("source")
        .where("org_id", "=", o.orgId)
        .executeTakeFirstOrThrow();
      expect(row.source).toBe("triage");
    });
  });

  test("8b: delegations.source takes triage or button only", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      const pair = await insertDraftAndSend(trx, o, o.mailboxId, { createdAt: new Date() });
      const delegateId = await insertDelegate(trx, o);
      await insertDelegation(trx, o, {
        mailboxId: o.mailboxId,
        emailId: pair.emailId,
        delegateId,
        draftActionId: pair.draftId,
        sendActionId: pair.sendId,
      });
      await expectSqlState(
        trx,
        () => sql`update delegations set source = 'hand' where org_id = ${o.orgId}::uuid`.execute(trx),
        CHECK
      );
      await sql`update delegations set source = 'button' where org_id = ${o.orgId}::uuid`.execute(trx);
      const row = await trx
        .selectFrom("delegations")
        .select("source")
        .where("org_id", "=", o.orgId)
        .executeTakeFirstOrThrow();
      expect(row.source).toBe("button");
    });
  });

  test("9: mailbox_settings.loop_wait_days defaults to 3 and takes 1 to 10", async () => {
    await withRollback(db, async (trx) => {
      const o = await createOrgWithMailbox(trx);
      await trx.insertInto("mailbox_settings").values({ mailbox_id: o.mailboxId, org_id: o.orgId }).execute();
      const read = async () =>
        (
          await trx
            .selectFrom("mailbox_settings")
            .select("loop_wait_days")
            .where("mailbox_id", "=", o.mailboxId)
            .executeTakeFirstOrThrow()
        ).loop_wait_days;
      expect(await read()).toBe(3);
      for (const bad of [0, 11]) {
        await expectSqlState(
          trx,
          () =>
            trx
              .updateTable("mailbox_settings")
              .set({ loop_wait_days: bad })
              .where("mailbox_id", "=", o.mailboxId)
              .execute(),
          CHECK
        );
      }
      for (const good of [1, 10]) {
        await trx
          .updateTable("mailbox_settings")
          .set({ loop_wait_days: good })
          .where("mailbox_id", "=", o.mailboxId)
          .execute();
        expect(await read()).toBe(good);
      }
    });
  });

  test("10: the thread index of emails is (mailbox_id, thread_key, received_at)", async () => {
    const { rows } = await sql<{ indexdef: string }>`
      select indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'emails' and indexname = 'emails_thread_received_idx'`.execute(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain("(mailbox_id, thread_key, received_at)");
  });
});

describe("open_loops: indexes", () => {
  test("11: the list index, the open-thread index and the sent-kind unique index have the shape of the interface", async () => {
    const { rows } = await sql<{ indexname: string; indexdef: string }>`
      select indexname, indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'open_loops' order by 1`.execute(db);
    const def = (name: string) => rows.find((row) => row.indexname === name)?.indexdef ?? "";
    expect(def("open_loops_mailbox_status_due_idx")).toContain("(org_id, mailbox_id, status, due_at)");
    expect(def("open_loops_thread_idx")).toContain("(mailbox_id, thread_key)");
    expect(def("open_loops_thread_idx")).toContain("WHERE (status = 'open'::text)");
    expect(def("open_loops_sent_kind_key")).toContain("UNIQUE INDEX");
    expect(def("open_loops_sent_kind_key")).toContain("(org_id, sent_email_id, kind)");
    expect(def("open_loops_sent_kind_key")).toContain("WHERE (sent_email_id IS NOT NULL)");
  });
});

const migration = readFileSync(
  join(import.meta.dir, "../../../../db/migrations/20261115160001_open_loops.sql"),
  "utf8"
);
const up = migration.split("-- migrate:down")[0] ?? "";
const down = migration.split("-- migrate:down")[1] ?? "";
// The later migration `action_loop_anchor` hangs keys on `open_loops`: it goes down first and comes up last.
const anchorMigration = readFileSync(
  join(import.meta.dir, "../../../../db/migrations/20261115170001_action_loop_anchor.sql"),
  "utf8"
);
const anchorUp = anchorMigration.split("-- migrate:down")[0] ?? "";
const anchorDown = anchorMigration.split("-- migrate:down")[1] ?? "";

async function schemaObjects(trx: Trx): Promise<{ tables: number; columns: number; indexes: number }> {
  const { rows } = await sql<{ tables: number; columns: number; indexes: number }>`
    select
      (select count(*) from pg_tables where schemaname = 'public' and tablename in ('open_loops', 'sent_analyses'))::int as tables,
      (select count(*) from information_schema.columns
        where table_schema = 'public'
          and ((table_name = 'delegations' and column_name = 'source')
            or (table_name = 'mailbox_settings' and column_name = 'loop_wait_days')))::int as columns,
      (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'emails_thread_received_idx')::int as indexes`.execute(
    trx
  );
  return rows[0] ?? { tables: -1, columns: -1, indexes: -1 };
}

// The Up and Down sections run inside a transaction (DDL is transactional) as the table owner and roll back, so the
// shared test DB keeps its schema.
describe("migration: Down and Up", () => {
  test("1: Down removes the new objects and keeps the old rows; Up adds them again", async () => {
    const url = process.env.MIGRATOR_DATABASE_URL;
    if (!url) throw new Error("MIGRATOR_DATABASE_URL is missing: the owner role runs the Down and Up sections");
    const owner = createDb(url);
    try {
      expect(up).not.toMatch(/DROP\s+(TABLE|COLUMN|CONSTRAINT)|ALTER\s+COLUMN|RENAME/i);
      await withRollback(owner, async (trx) => {
        const o = await createOrgWithMailbox(trx);
        const pair = await insertDraftAndSend(trx, o, o.mailboxId, { createdAt: new Date() });
        const delegateId = await insertDelegate(trx, o);
        await insertDelegation(trx, o, {
          mailboxId: o.mailboxId,
          emailId: pair.emailId,
          delegateId,
          draftActionId: pair.draftId,
          sendActionId: pair.sendId,
        });
        await trx.insertInto("mailbox_settings").values({ mailbox_id: o.mailboxId, org_id: o.orgId }).execute();
        const sentId = await insertSentRow(trx, o, o.mailboxId);
        await insertLoopRow(trx, o, o.mailboxId, { sent_email_id: sentId });
        await insertAnalysisRow(trx, o, o.mailboxId, sentId);
        expect(await schemaObjects(trx)).toEqual({ tables: 2, columns: 2, indexes: 1 });

        const oldRows = async () => ({
          delegations: await count2(trx, "delegations", o.orgId),
          emails: await count2(trx, "emails", o.orgId),
          sent_emails: await count2(trx, "sent_emails", o.orgId),
          mailbox_settings: await count2(trx, "mailbox_settings", o.orgId),
        });
        const before = await oldRows();
        expect(before).toEqual({ delegations: 1, emails: 1, sent_emails: 1, mailbox_settings: 1 });

        await sql.raw(anchorDown).execute(trx);
        await sql.raw(down).execute(trx);
        expect(await schemaObjects(trx)).toEqual({ tables: 0, columns: 0, indexes: 0 });
        expect(await oldRows()).toEqual(before);

        await sql.raw(up).execute(trx);
        await sql.raw(anchorUp).execute(trx);
        expect(await schemaObjects(trx)).toEqual({ tables: 2, columns: 2, indexes: 1 });
        expect(await oldRows()).toEqual(before);
        const settings = await trx
          .selectFrom("mailbox_settings")
          .select("loop_wait_days")
          .where("org_id", "=", o.orgId)
          .executeTakeFirstOrThrow();
        expect(settings.loop_wait_days).toBe(3);
      });
    } finally {
      await owner.destroy();
    }
  });
});

async function count2(
  trx: Trx,
  table: "delegations" | "emails" | "sent_emails" | "mailbox_settings",
  orgId: string
): Promise<number> {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from ${sql.table(table)} where org_id = ${orgId}::uuid`.execute(trx);
  return rows[0]?.n ?? 0;
}
