import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail, insertTriagedWithActions } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// Constraints of the F100 stage 04 migration (spec/features/active/F100-e3a-measure/stages/stage-04-migration.md).
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const NOW = new Date("2026-11-20T10:00:00Z");

type Trx = Transaction<DB>;

function sqlState(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}

// A Postgres error aborts the transaction: the savepoint lets the test go on after it.
async function expectSqlState(trx: Trx, run: () => Promise<unknown>, code: string): Promise<void> {
  await sql`savepoint f100_case`.execute(trx);
  let state: string | undefined;
  try {
    await run();
  } catch (error) {
    state = sqlState(error);
  }
  expect(state).toBe(code);
  await sql`rollback to savepoint f100_case`.execute(trx);
}

const CHECK = "23514";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";

const headers = (emailId: string, orgId: string) => ({
  email_id: emailId,
  org_id: orgId,
  parts_known: true,
  captured_at: NOW,
});

const flags = (emailId: string, orgId: string) => ({
  email_id: emailId,
  org_id: orgId,
  seen: true,
  answered: false,
  flagged: false,
  checked_at: NOW,
});

async function twoOrgs(trx: Trx) {
  const a = await createOrgWithMailbox(trx);
  const b = await createOrgWithMailbox(trx);
  const m1 = await insertTestEmail(trx, a, a.mailboxId);
  const m2 = await insertTestEmail(trx, a, a.mailboxId);
  return { a, b, m1, m2 };
}

// One triaged mail with one action; `noUncheckedIndexedAccess` makes the first id optional, so the helper checks it.
async function triagedMail(trx: Trx, org: { orgId: string; mailboxId: string }) {
  const t = await insertTriagedWithActions(trx, org, org.mailboxId, {
    category: "info",
    createdAt: NOW,
    actions: [{ type: "move", status: "applied" }],
  });
  const actionId = t.actionIds[0];
  if (!actionId) throw new Error("fixture made no action");
  return { emailId: t.emailId, actionId };
}

async function count(trx: Trx, table: "email_headers" | "email_flags" | "action_feedback", orgId: string) {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from ${sql.table(table)} where org_id = ${orgId}::uuid`.execute(trx);
  return rows[0]?.n ?? 0;
}

describe("measure capture tables", () => {
  test("1: the foreign key to emails holds the org", async () => {
    await withRollback(db, async (trx) => {
      const { a, b, m1, m2 } = await twoOrgs(trx);
      await trx.insertInto("email_headers").values(headers(m1, a.orgId)).execute();
      await trx.insertInto("email_flags").values(flags(m1, a.orgId)).execute();
      // m2 has no row yet, so the primary key cannot fire before the foreign key.
      await expectSqlState(
        trx,
        () => trx.insertInto("email_headers").values(headers(m2, b.orgId)).execute(),
        FOREIGN_KEY
      );
      await expectSqlState(trx, () => trx.insertInto("email_flags").values(flags(m2, b.orgId)).execute(), FOREIGN_KEY);
    });
  });

  test("2: email_headers limits", async () => {
    await withRollback(db, async (trx) => {
      const { a, m1 } = await twoOrgs(trx);
      const base = headers(m1, a.orgId);
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("email_headers")
            .values({ ...base, reply_to: ["a", "b", "c", "d", "e", "f"] })
            .execute(),
        CHECK
      );
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("email_headers")
            .values({ ...base, from_name: "x".repeat(201) })
            .execute(),
        CHECK
      );
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("email_headers")
            .values({ ...base, attachments: sql`'{}'::jsonb` as never })
            .execute(),
        CHECK
      );
    });
  });

  test("3: email_flags answered check", async () => {
    await withRollback(db, async (trx) => {
      const { a, m1 } = await twoOrgs(trx);
      const base = flags(m1, a.orgId);
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("email_flags")
            .values({ ...base, answered_check: "yes", answered_check_at: null })
            .execute(),
        CHECK
      );
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("email_flags")
            .values({ ...base, answered_check: "maybe", answered_check_at: NOW })
            .execute(),
        CHECK
      );
    });
  });

  test("4: action_feedback kind and reason", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const t = await triagedMail(trx, a);
      const base = { org_id: a.orgId, action_id: t.actionId, via: "web", created_at: NOW, updated_at: NOW };
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("action_feedback")
            .values({ ...base, kind: "reject_reason", reason: null })
            .execute(),
        CHECK
      );
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("action_feedback")
            .values({ ...base, kind: "mistake", reason: "wrong_person" })
            .execute(),
        CHECK
      );
      await trx
        .insertInto("action_feedback")
        .values({ ...base, kind: "reject_reason", reason: "not_needed" })
        .execute();
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("action_feedback")
            .values({ ...base, kind: "reject_reason", reason: "wrong_content" })
            .execute(),
        UNIQUE
      );
    });
  });

  test("5: deleting the mail or the action cascades", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const t = await triagedMail(trx, a);
      const { actionId } = t;
      await trx.insertInto("email_headers").values(headers(t.emailId, a.orgId)).execute();
      await trx.insertInto("email_flags").values(flags(t.emailId, a.orgId)).execute();
      await trx
        .insertInto("action_feedback")
        .values({ org_id: a.orgId, action_id: actionId, kind: "mistake", via: "cli", created_at: NOW, updated_at: NOW })
        .execute();

      await trx.deleteFrom("actions").where("id", "=", actionId).execute();
      expect(await count(trx, "action_feedback", a.orgId)).toBe(0);
      expect(await count(trx, "email_headers", a.orgId)).toBe(1);

      await trx.deleteFrom("emails").where("id", "=", t.emailId).execute();
      expect(await count(trx, "email_headers", a.orgId)).toBe(0);
      expect(await count(trx, "email_flags", a.orgId)).toBe(0);
    });
  });

  test("6: triage_feedback accepts answered_check and refuses an unknown source", async () => {
    await withRollback(db, async (trx) => {
      const { a, m1, m2 } = await twoOrgs(trx);
      const base = { org_id: a.orgId, verdict: "right", true_category: "info" };
      await trx
        .insertInto("triage_feedback")
        .values({ ...base, email_id: m1, source: "answered_check" })
        .execute();
      await expectSqlState(
        trx,
        () =>
          trx
            .insertInto("triage_feedback")
            .values({ ...base, email_id: m2, source: "other" })
            .execute(),
        CHECK
      );
    });
  });

  test("7: delete_mailbox removes the new rows of the mailbox", async () => {
    await withRollback(db, async (trx) => {
      const a = await createOrgWithMailbox(trx);
      const t = await triagedMail(trx, a);
      await trx.insertInto("email_headers").values(headers(t.emailId, a.orgId)).execute();
      await trx.insertInto("email_flags").values(flags(t.emailId, a.orgId)).execute();
      await trx
        .insertInto("action_feedback")
        .values({
          org_id: a.orgId,
          action_id: t.actionId,
          kind: "mistake",
          via: "web",
          created_at: NOW,
          updated_at: NOW,
        })
        .execute();
      await sql`select delete_mailbox(${a.orgId}::uuid, ${a.mailboxId}::uuid)`.execute(trx);
      expect(await count(trx, "email_headers", a.orgId)).toBe(0);
      expect(await count(trx, "email_flags", a.orgId)).toBe(0);
      expect(await count(trx, "action_feedback", a.orgId)).toBe(0);
    });
  });
});
