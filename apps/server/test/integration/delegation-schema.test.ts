import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

const now = new Date("2026-11-08T10:00:00Z");

interface ActionOverrides {
  type: string;
  status: string;
  applied_at?: Date | null;
  approved_at?: Date | null;
}

async function insertAction(
  trx: Transaction<DB>,
  orgId: string,
  emailId: string,
  overrides: ActionOverrides
): Promise<string> {
  const row = await trx
    .insertInto("actions")
    .values({
      org_id: orgId,
      email_id: emailId,
      idempotency_key: `test:${randomUUID()}`,
      ...overrides,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

async function insertDelegate(
  trx: Transaction<DB>,
  orgId: string,
  overrides: { name?: string; email?: string } = {}
): Promise<string> {
  const row = await trx
    .insertInto("delegates")
    .values({
      org_id: orgId,
      name: overrides.name ?? "Delegate",
      email: overrides.email ?? `delegate-${randomUUID()}@x.test`,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

interface DelegationOverrides {
  status?: string;
  sent_message_id?: string | null;
  sent_at?: Date | null;
  send_action_id?: string;
  answered_email_id?: string | null;
}

// A delegation with its own mail, draft and send actions; `overrides` replaces single columns.
async function insertDelegation(
  trx: Transaction<DB>,
  ids: { orgId: string; mailboxId: string; emailId: string; delegateId: string },
  overrides: DelegationOverrides = {}
): Promise<{ id: string; sendActionId: string }> {
  const draftId = await insertAction(trx, ids.orgId, ids.emailId, { type: "create_draft", status: "ready" });
  const sendActionId =
    overrides.send_action_id ??
    (await insertAction(trx, ids.orgId, ids.emailId, { type: "send", status: "awaiting_approval" }));
  const row = await trx
    .insertInto("delegations")
    .values({
      org_id: ids.orgId,
      mailbox_id: ids.mailboxId,
      email_id: ids.emailId,
      delegate_id: ids.delegateId,
      draft_action_id: draftId,
      send_action_id: sendActionId,
      task_summary: "task",
      ...overrides,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return { id: row.id, sendActionId };
}

async function insertOutbox(
  trx: Transaction<DB>,
  orgId: string,
  userId: string,
  kind: string,
  extra: { email_id?: string; digest_id?: string }
): Promise<void> {
  await trx
    .insertInto("outbox")
    .values({
      org_id: orgId,
      user_id: userId,
      kind,
      dedup_key: `test:${randomUUID()}`,
      text: "x",
      next_attempt_at: now,
      created_at: now,
      ...extra,
    })
    .execute();
}

// A statement that must fail aborts the transaction: run it in a savepoint and roll back to it.
async function expectCode(
  trx: Transaction<DB>,
  name: string,
  run: () => Promise<unknown>,
  code: string,
  constraint?: string
) {
  await sql`savepoint ${sql.id(name)}`.execute(trx);
  await expect(run()).rejects.toMatchObject(constraint ? { code, constraint } : { code });
  await sql`rollback to savepoint ${sql.id(name)}`.execute(trx);
}

describe("S4 schema: actions", () => {
  test("a send on its way out needs approved_at; a send is never ready", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      await expectCode(
        trx,
        "approved_without_time",
        () => insertAction(trx, orgId, emailId, { type: "send", status: "approved" }),
        "23514",
        "actions_send_approved_check"
      );
      await insertAction(trx, orgId, emailId, { type: "send", status: "approved", approved_at: now });
      await expectCode(
        trx,
        "applied_without_approval",
        () => insertAction(trx, orgId, emailId, { type: "send", status: "applied", applied_at: now }),
        "23514",
        "actions_send_approved_check"
      );
      await expectCode(
        trx,
        "send_ready",
        () => insertAction(trx, orgId, emailId, { type: "send", status: "ready" }),
        "23514",
        "actions_send_never_ready_check"
      );
      await insertAction(trx, orgId, emailId, { type: "send", status: "awaiting_approval" });
    });
  });

  test("create_draft is a known type; an unknown type is refused", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      await insertAction(trx, orgId, emailId, { type: "create_draft", status: "ready" });
      await expectCode(
        trx,
        "unknown_type",
        () => insertAction(trx, orgId, emailId, { type: "nope", status: "ready" }),
        "23514"
      );
    });
  });
});

describe("S4 schema: delegates", () => {
  test("email is lower case, name is 1 to 100 characters", async () => {
    await withRollback(db, async (trx) => {
      const { orgId } = await createOrgWithMailbox(trx);
      await expectCode(trx, "upper_email", () => insertDelegate(trx, orgId, { email: "Ann@x.test" }), "23514");
      await expectCode(trx, "long_name", () => insertDelegate(trx, orgId, { name: "n".repeat(101) }), "23514");
      await insertDelegate(trx, orgId, { name: "n".repeat(100) });
    });
  });

  test("an email is unique per organization", async () => {
    await withRollback(db, async (trx) => {
      const first = await createOrgWithMailbox(trx);
      const second = await createOrgWithMailbox(trx);
      await insertDelegate(trx, first.orgId, { email: "ann@x.test" });
      await expectCode(trx, "same_email", () => insertDelegate(trx, first.orgId, { email: "ann@x.test" }), "23505");
      await insertDelegate(trx, second.orgId, { email: "ann@x.test" });
    });
  });
});

describe("S4 schema: delegations", () => {
  test("status sent needs the message id and the sent time", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      const delegateId = await insertDelegate(trx, orgId);
      const ids = { orgId, mailboxId, emailId, delegateId };
      await expectCode(trx, "sent_bare", () => insertDelegation(trx, ids, { status: "sent" }), "23514");
      await expectCode(
        trx,
        "sent_no_time",
        () => insertDelegation(trx, ids, { status: "sent", sent_message_id: "<m@x.test>" }),
        "23514"
      );
      await insertDelegation(trx, ids, { status: "sent", sent_message_id: "<m@x.test>", sent_at: now });
    });
  });

  test("a delegate of another organization is refused", async () => {
    await withRollback(db, async (trx) => {
      const own = await createOrgWithMailbox(trx);
      const other = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId: own.orgId }, own.mailboxId);
      const foreignDelegate = await insertDelegate(trx, other.orgId);
      await expectCode(
        trx,
        "foreign_delegate",
        () =>
          insertDelegation(trx, { orgId: own.orgId, mailboxId: own.mailboxId, emailId, delegateId: foreignDelegate }),
        "23503"
      );
    });
  });

  test("one send action belongs to one delegation", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      const delegateId = await insertDelegate(trx, orgId);
      const ids = { orgId, mailboxId, emailId, delegateId };
      const first = await insertDelegation(trx, ids);
      await expectCode(
        trx,
        "same_send",
        () => insertDelegation(trx, ids, { send_action_id: first.sendActionId }),
        "23505"
      );
    });
  });

  test("answered_email_id becomes NULL when the answer mail is deleted", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      const answerId = await insertTestEmail(trx, { orgId }, mailboxId);
      const delegateId = await insertDelegate(trx, orgId);
      const { id } = await insertDelegation(
        trx,
        { orgId, mailboxId, emailId, delegateId },
        { answered_email_id: answerId }
      );
      await trx.deleteFrom("emails").where("id", "=", answerId).execute();
      const row = await trx
        .selectFrom("delegations")
        .select("answered_email_id")
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row.answered_email_id).toBeNull();
    });
  });
});

describe("S4 schema: outbox", () => {
  test("the new kinds need email_id; digest still needs digest_id", async () => {
    await withRollback(db, async (trx) => {
      const { orgId, userId, mailboxId } = await createOrgWithMailbox(trx);
      const emailId = await insertTestEmail(trx, { orgId }, mailboxId);
      for (const kind of ["approval", "approval_set", "send_result", "delegation_answered"]) {
        await insertOutbox(trx, orgId, userId, kind, { email_id: emailId });
      }
      await expectCode(trx, "approval_no_email", () => insertOutbox(trx, orgId, userId, "approval", {}), "23514");
      await expectCode(trx, "no_digest", () => insertOutbox(trx, orgId, userId, "digest", {}), "23514");
    });
  });
});

describe("S4 schema: indexes", () => {
  test("pg_indexes lists the new indexes", async () => {
    const result = await sql<{ indexname: string }>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('delegates_org_email_key', 'actions_depends_on_idx', 'actions_org_type_status_idx', 'delegations_mailbox_status_idx', 'delegations_status_due_idx')
    `.execute(db);
    expect(result.rows.map((r) => r.indexname).sort()).toEqual([
      "actions_depends_on_idx",
      "actions_org_type_status_idx",
      "delegates_org_email_key",
      "delegations_mailbox_status_idx",
      "delegations_status_due_idx",
    ]);
  });
});
