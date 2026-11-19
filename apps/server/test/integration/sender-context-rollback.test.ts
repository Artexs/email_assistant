import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { insertLoopRow } from "./loops-fixtures";

// The rollback statements of `deploy/README.md` § Sender context run for real: they are read from the file, so a change of the
// documented SQL is tested, and a statement that no longer works fails here. The old release reads `open_loops.due_source` as a
// strict enum and the view of `weekly_report` as a strict object. The operator runs the SQL as the database owner (no row policy);
// this test runs as the `app` role with the organization set, which sees the same rows.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const readme = readFileSync(join(import.meta.dir, "../../../../deploy/README.md"), "utf8");

// The SQL between `<<'SQL'` and `SQL` in the section "Roll back" of the section "Sender context" of the deploy guide, without the list indent.
function rollbackSql(): string {
  const start = readme.indexOf("\n## Sender context (F120)\n");
  expect(start).toBeGreaterThan(-1);
  const end = readme.indexOf("\n## ", start + 1);
  const section = readme.slice(start, end);
  const open = section.indexOf("<<'SQL'\n");
  expect(open).toBeGreaterThan(-1);
  const close = section.indexOf("\n   SQL\n", open);
  expect(close).toBeGreaterThan(open);
  return section
    .slice(open + "<<'SQL'\n".length, close)
    .split("\n")
    .map((line) => line.replace(/^ {3}/, ""))
    .join("\n");
}

async function outboxRow(
  trx: Trx,
  orgId: string,
  userId: string,
  row: { kind: string; status: string; view: Record<string, unknown>; mailboxId?: string }
): Promise<string> {
  const at = new Date("2026-11-19T10:00:00Z");
  const inserted = await trx
    .insertInto("outbox")
    .values({
      org_id: orgId,
      user_id: userId,
      kind: row.kind,
      status: row.status,
      dedup_key: `test:${randomUUID()}`,
      text: "x",
      view: JSON.stringify(row.view),
      // The table CHECKs tie `sent_at` to `sent` and `locked_at` to `sending`.
      sent_at: row.status === "sent" ? at : null,
      locked_at: row.status === "sending" ? at : null,
      mailbox_id: row.mailboxId ?? null,
      next_attempt_at: at,
      created_at: at,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

async function seed(trx: Trx) {
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  await sql`select set_config('app.org_id', ${created.orgId}, true)`.execute(trx);
  const due = new Date("2026-11-20T10:00:00Z");
  const loops = {
    contact: await insertLoopRow(trx, ctx, created.mailboxId, {
      due_source: "contact",
      usual_reply_days: 2,
      due_at: due,
    }),
    stated: await insertLoopRow(trx, ctx, created.mailboxId, { due_source: "stated", due_at: due }),
    plain: await insertLoopRow(trx, ctx, created.mailboxId, { due_source: "default", due_at: due }),
  };
  const withKey = { suggestions: { open: 2 } };
  const outbox = {
    pendingWithKey: await outboxRow(trx, created.orgId, created.userId, {
      kind: "weekly_report",
      status: "pending",
      view: withKey,
    }),
    sendingWithKey: await outboxRow(trx, created.orgId, created.userId, {
      kind: "weekly_report",
      status: "sending",
      view: withKey,
    }),
    pendingWithout: await outboxRow(trx, created.orgId, created.userId, {
      kind: "weekly_report",
      status: "pending",
      view: {},
    }),
    sentWithKey: await outboxRow(trx, created.orgId, created.userId, {
      kind: "weekly_report",
      status: "sent",
      view: withKey,
    }),
    otherKind: await outboxRow(trx, created.orgId, created.userId, {
      kind: "sync_stale",
      status: "pending",
      view: {},
      mailboxId: created.mailboxId,
    }),
  };
  return { loops, outbox, due };
}

const loopOf = (trx: Trx, id: string) =>
  trx
    .selectFrom("open_loops")
    .select(["due_source", "usual_reply_days", "due_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

const outboxOf = (trx: Trx, id: string) =>
  trx.selectFrom("outbox").select(["status", "error_code"]).where("id", "=", id).executeTakeFirstOrThrow();

describe("the rollback SQL of deploy/README.md § Sender context", () => {
  test("it sets every contact loop to default and keeps the due date, and leaves the other loops as they were", async () => {
    await withRollback(db, async (trx) => {
      const { loops, due } = await seed(trx);
      await sql.raw(rollbackSql()).execute(trx);
      expect(await loopOf(trx, loops.contact)).toEqual({ due_source: "default", usual_reply_days: null, due_at: due });
      expect(await loopOf(trx, loops.stated)).toEqual({ due_source: "stated", usual_reply_days: null, due_at: due });
      expect(await loopOf(trx, loops.plain)).toEqual({ due_source: "default", usual_reply_days: null, due_at: due });
    });
  });

  test("it fails the pending and sending weekly_report rows that hold the key suggestions, and no other outbox row", async () => {
    await withRollback(db, async (trx) => {
      const { outbox } = await seed(trx);
      await sql.raw(rollbackSql()).execute(trx);
      expect(await outboxOf(trx, outbox.pendingWithKey)).toEqual({ status: "failed", error_code: "outdated" });
      expect(await outboxOf(trx, outbox.sendingWithKey)).toEqual({ status: "failed", error_code: "outdated" });
      expect(await outboxOf(trx, outbox.pendingWithout)).toEqual({ status: "pending", error_code: null });
      expect(await outboxOf(trx, outbox.sentWithKey)).toEqual({ status: "sent", error_code: null });
      expect(await outboxOf(trx, outbox.otherKind)).toEqual({ status: "pending", error_code: null });
    });
  });

  test("it is safe to run twice", async () => {
    await withRollback(db, async (trx) => {
      const { loops, outbox } = await seed(trx);
      await sql.raw(rollbackSql()).execute(trx);
      await sql.raw(rollbackSql()).execute(trx);
      expect((await loopOf(trx, loops.contact)).due_source).toBe("default");
      expect(await outboxOf(trx, outbox.pendingWithKey)).toEqual({ status: "failed", error_code: "outdated" });
    });
  });
});
