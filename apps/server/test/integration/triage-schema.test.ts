import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

async function insertEmail(trx: Transaction<DB>, orgId: string, mailboxId: string, dedupKey: string) {
  const email = await trx
    .insertInto("emails")
    .values({
      org_id: orgId,
      mailbox_id: mailboxId,
      dedup_key: dedupKey,
      content_hash: "hash-1",
      uid: 1,
      thread_key: "thread-1",
      received_at: new Date("2026-11-04T10:00:00Z"),
    })
    .returning(["id", "backfilled_at"])
    .executeTakeFirstOrThrow();
  return email;
}

// A statement that must fail aborts the transaction: run it in a savepoint and roll back to it.
async function expectFailure(
  trx: Transaction<DB>,
  name: string,
  run: () => Promise<unknown>,
  expected: { code?: string; message?: string }
) {
  await sql`savepoint ${sql.id(name)}`.execute(trx);
  const promise = run();
  if (expected.code) {
    await expect(promise).rejects.toMatchObject({ code: expected.code });
  } else {
    await expect(promise).rejects.toThrow(expected.message);
  }
  await sql`rollback to savepoint ${sql.id(name)}`.execute(trx);
}

function actionRow(orgId: string, emailId: string, idempotencyKey: string) {
  return {
    org_id: orgId,
    email_id: emailId,
    type: "move",
    status: "logged",
    idempotency_key: idempotencyKey,
  };
}

describe("triage schema", () => {
  test("one row in each table inserts and a new email has backfilled_at NULL", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
      const email = await insertEmail(trx, orgId, mailboxId, "mid:1");
      expect(email.backfilled_at).toBeNull();

      const rule = await trx
        .insertInto("sender_rules")
        .values({ org_id: orgId, mailbox_id: null, pattern: "boss@x.test", kind: "vip" })
        .returning(["id", "mailbox_id"])
        .executeTakeFirstOrThrow();
      expect(rule.mailbox_id).toBeNull();

      const result = await trx
        .insertInto("triage_results")
        .values({ org_id: orgId, email_id: email.id, category: "info", confidence: 0.9, reason_code: "llm" })
        .returning(["vip", "fields", "model"])
        .executeTakeFirstOrThrow();
      expect(result).toEqual({ vip: false, fields: {}, model: null });

      const feedback = await trx
        .insertInto("triage_feedback")
        .values({
          org_id: orgId,
          email_id: email.id,
          verdict: "wrong",
          true_category: "urgent",
          source: "cli",
          user_id: userId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      expect(feedback.id).toBeString();

      const action = await trx
        .insertInto("actions")
        .values(actionRow(orgId, email.id, "key-1"))
        .returning(["id", "attempts", "payload"])
        .executeTakeFirstOrThrow();
      expect(action.attempts).toBe(0);
      expect(action.payload).toEqual({});

      const audit = await trx
        .insertInto("audit_log")
        .values({ org_id: orgId, email_id: email.id, action_id: action.id, actor: "system", event: "action.logged" })
        .returning(["id", "data"])
        .executeTakeFirstOrThrow();
      expect(audit.data).toEqual({});
    });
  });

  test("app cannot update or delete audit_log rows", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      await trx.insertInto("audit_log").values({ org_id: orgId, actor: "system", event: "llm.call" }).execute();
      await expectFailure(
        trx,
        "audit_update",
        () => trx.updateTable("audit_log").set({ event: "x" }).where("org_id", "=", orgId).execute(),
        { message: "permission denied for table audit_log" }
      );
      await expectFailure(
        trx,
        "audit_delete",
        () => trx.deleteFrom("audit_log").where("org_id", "=", orgId).execute(),
        { message: "permission denied for table audit_log" }
      );
    });
  });

  test("a bad category, status, verdict, source or kind fails with 23514", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const email = await insertEmail(trx, orgId, mailboxId, "mid:1");
      const check = { code: "23514" };

      await expectFailure(
        trx,
        "bad_category",
        () =>
          trx
            .insertInto("triage_results")
            .values({ org_id: orgId, email_id: email.id, category: "x", confidence: 0.5, reason_code: "llm" })
            .execute(),
        check
      );
      await expectFailure(
        trx,
        "bad_status",
        () =>
          trx
            .insertInto("actions")
            .values({ ...actionRow(orgId, email.id, "key-1"), status: "x" })
            .execute(),
        check
      );
      await expectFailure(
        trx,
        "bad_verdict",
        () =>
          trx
            .insertInto("triage_feedback")
            .values({ org_id: orgId, email_id: email.id, verdict: "x", source: "cli" })
            .execute(),
        check
      );
      await expectFailure(
        trx,
        "bad_source",
        () =>
          trx
            .insertInto("triage_feedback")
            .values({ org_id: orgId, email_id: email.id, verdict: "right", source: "x" })
            .execute(),
        check
      );
      await expectFailure(
        trx,
        "bad_kind",
        () => trx.insertInto("sender_rules").values({ org_id: orgId, pattern: "a@x.test", kind: "x" }).execute(),
        check
      );
    });
  });

  test("a second sender rule with the same org, NULL mailbox, pattern and kind fails with 23505", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      const rule = { org_id: orgId, mailbox_id: null, pattern: "x.test", kind: "blocklist" };
      await trx.insertInto("sender_rules").values(rule).execute();
      await expectFailure(trx, "duplicate_rule", () => trx.insertInto("sender_rules").values(rule).execute(), {
        code: "23505",
      });
    });
  });

  test("an upper-case sender rule pattern fails with 23514", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      await expectFailure(
        trx,
        "upper_pattern",
        () => trx.insertInto("sender_rules").values({ org_id: orgId, pattern: "Boss@x.test", kind: "vip" }).execute(),
        { code: "23514" }
      );
    });
  });

  test("a triage result with the email of another org fails with 23503", async () => {
    await withRollback(db, async (trx) => {
      const orgA = await createOrgWithMailbox(trx);
      const orgB = await createOrgWithMailbox(trx);
      const emailA = await insertEmail(trx, orgA.orgId, orgA.mailboxId, "mid:1");
      await expectFailure(
        trx,
        "cross_org",
        () =>
          trx
            .insertInto("triage_results")
            .values({
              org_id: orgB.orgId,
              email_id: emailA.id,
              category: "info",
              confidence: 0.5,
              reason_code: "llm",
            })
            .execute(),
        { code: "23503" }
      );
    });
  });

  test("an action that depends on an action of another org fails with 23503", async () => {
    await withRollback(db, async (trx) => {
      const orgA = await createOrgWithMailbox(trx);
      const orgB = await createOrgWithMailbox(trx);
      const emailA = await insertEmail(trx, orgA.orgId, orgA.mailboxId, "mid:1");
      const emailB = await insertEmail(trx, orgB.orgId, orgB.mailboxId, "mid:1");
      const actionA = await trx
        .insertInto("actions")
        .values(actionRow(orgA.orgId, emailA.id, "key-1"))
        .returning("id")
        .executeTakeFirstOrThrow();
      await expectFailure(
        trx,
        "cross_org_action",
        () =>
          trx
            .insertInto("actions")
            .values({ ...actionRow(orgB.orgId, emailB.id, "key-1"), depends_on_action_id: actionA.id })
            .execute(),
        { code: "23503" }
      );
    });
  });
});
