import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "bun:test";
import { sql, type Transaction } from "kysely";

import type { DB } from "../../src/platform/db";

import { createOrgWithMailbox, insertDraftAndSend } from "./fixtures";
import { testDb, withRollback } from "./helpers";

// The rollback SQL of `deploy/README.md` § Reply drafts runs for real: it is read from the file, so a change of the documented SQL is
// tested and a statement that no longer works fails here. The old release rejects the new notice kinds and views and does not know the
// draft kind `reply`. The operator runs the block as the database owner (no row policy, its own BEGIN and COMMIT); this test strips
// both lines to keep its own rollback, and runs as the `app` role with the organization set, which sees the same rows.
const db = testDb();
afterAll(async () => {
  await db.destroy();
});

type Trx = Transaction<DB>;

const readme = readFileSync(join(import.meta.dir, "../../../../deploy/README.md"), "utf8");

// The SQL between `<<'SQL'` and `SQL` in the section "Reply drafts", without the transaction lines.
function rollbackSql(): string {
  const start = readme.indexOf("\n## Reply drafts (F115)\n");
  expect(start).toBeGreaterThan(-1);
  const end = readme.indexOf("\n## ", start + 1);
  const section = readme.slice(start, end);
  const open = section.indexOf("<<'SQL'\n");
  expect(open).toBeGreaterThan(-1);
  // The block is not indented, so it can be copied from the raw file: the closing line is `SQL` at the start of a line.
  const close = section.indexOf("\nSQL\n", open);
  expect(close).toBeGreaterThan(open);
  return section
    .slice(open + "<<'SQL'\n".length, close)
    .split("\n")
    .filter((line) => line !== "BEGIN;" && line !== "COMMIT;")
    .join("\n");
}

// The notice statement only: the part before the open-reply statement. A target from the stage that added the reply kind on runs this part alone.
function noticeSql(): string {
  const all = rollbackSql();
  const cut = all.indexOf("-- (b)");
  expect(cut).toBeGreaterThan(-1);
  return all.slice(0, cut);
}

const AT = new Date("2026-11-19T10:00:00Z");

async function outboxRow(
  trx: Trx,
  orgId: string,
  userId: string,
  row: {
    kind: string;
    status: string;
    dedupKey?: string;
    view?: Record<string, unknown>;
    emailId?: string;
    mailboxId?: string;
  }
): Promise<string> {
  const inserted = await trx
    .insertInto("outbox")
    .values({
      org_id: orgId,
      user_id: userId,
      kind: row.kind,
      status: row.status,
      dedup_key: row.dedupKey ?? `test:${randomUUID()}`,
      text: "x",
      view: JSON.stringify(row.view ?? {}),
      // The table CHECKs tie `sent_at` to `sent` and `locked_at` to `sending`.
      sent_at: row.status === "sent" ? AT : null,
      locked_at: row.status === "sending" ? AT : null,
      email_id: row.emailId ?? null,
      mailbox_id: row.mailboxId ?? null,
      next_attempt_at: AT,
      created_at: AT,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

const outboxOf = (trx: Trx, id: string) =>
  trx.selectFrom("outbox").select(["status", "error_code"]).where("id", "=", id).executeTakeFirstOrThrow();

const actionOf = (trx: Trx, id: string) =>
  trx
    .selectFrom("actions")
    .select(["status", "status_reason", "locked_at", "next_attempt_at", "result_notified_at"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();

const auditOf = (trx: Trx, actionId: string) =>
  trx
    .selectFrom("audit_log")
    .select(["actor", "event", "reason_code", "data"])
    .where("action_id", "=", actionId)
    .where("event", "=", "action.expired")
    .execute();

async function seed(trx: Trx) {
  const created = await createOrgWithMailbox(trx);
  const ctx = { orgId: created.orgId };
  await sql`select set_config('app.org_id', ${created.orgId}, true)`.execute(trx);
  const mail = await insertDraftAndSend(trx, ctx, created.mailboxId, { kind: "clarification" });
  const emailId = mail.emailId;
  const sendId = randomUUID();
  const row = (r: Parameters<typeof outboxRow>[3]) => outboxRow(trx, created.orgId, created.userId, r);
  const outbox = {
    readyPending: await row({ kind: "replies_ready", status: "pending" }),
    readySending: await row({ kind: "replies_ready", status: "sending" }),
    readySent: await row({ kind: "replies_ready", status: "sent" }),
    promptPending: await row({ kind: "reply_prompt", status: "pending", emailId }),
    resultSending: await row({ kind: "reply_result", status: "sending", emailId }),
    reviewPending: await row({ kind: "approval", status: "pending", dedupKey: `approval:${sendId}:r1`, emailId }),
    reviewSending: await row({ kind: "approval", status: "sending", dedupKey: `approval:${sendId}:r12`, emailId }),
    reviewSent: await row({ kind: "approval", status: "sent", dedupKey: `approval:${sendId}:r2`, emailId }),
    // The card of an ordinary send keeps its key `approval:<send id>` and is not touched.
    plainCard: await row({ kind: "approval", status: "pending", dedupKey: `approval:${sendId}`, emailId }),
    weeklyWithKey: await row({
      kind: "weekly_report",
      status: "pending",
      view: { week: { replyDrafts: { made: 1 } } },
    }),
    weeklyWithout: await row({ kind: "weekly_report", status: "pending", view: { week: {} } }),
    urgentWithKey: await row({ kind: "urgent", status: "pending", view: { draftable: true }, emailId }),
    urgentWithout: await row({ kind: "urgent", status: "pending", view: {}, emailId }),
    otherKind: await row({ kind: "sync_stale", status: "pending", mailboxId: created.mailboxId }),
  };
  const pair = (sendStatus: string, draftStatus: string) =>
    insertDraftAndSend(trx, ctx, created.mailboxId, {
      kind: "reply",
      sendStatus,
      draftStatus,
      ...(["approved", "applying", "applied"].includes(sendStatus)
        ? { approved: { userId: created.userId, at: AT } }
        : {}),
    });
  const replies = {
    waiting: await pair("awaiting_approval", "ready"),
    waitingApplied: await pair("awaiting_approval", "applied"),
    waitingApplying: await pair("awaiting_approval", "applying"),
    held: await pair("approved", "applied"),
    applying: await pair("applying", "applied"),
    sent: await pair("applied", "applied"),
    rejected: await pair("rejected", "expired"),
  };
  const other = await insertDraftAndSend(trx, ctx, created.mailboxId, { kind: "delegation" });
  return { outbox, replies, other };
}

describe("the rollback SQL of deploy/README.md § Reply drafts", () => {
  test("it fails the pending and sending rows of the three kinds, the review cards and the weekly rows with the key, and no other outbox row", async () => {
    await withRollback(db, async (trx) => {
      const { outbox } = await seed(trx);
      await sql.raw(rollbackSql()).execute(trx);
      const failed = { status: "failed", error_code: "outdated" };
      for (const id of [
        outbox.readyPending,
        outbox.readySending,
        outbox.promptPending,
        outbox.resultSending,
        outbox.reviewPending,
        outbox.reviewSending,
        outbox.weeklyWithKey,
        outbox.urgentWithKey,
      ]) {
        expect(await outboxOf(trx, id)).toEqual(failed);
      }
      const kept = { status: "pending", error_code: null };
      expect(await outboxOf(trx, outbox.readySent)).toEqual({ status: "sent", error_code: null });
      expect(await outboxOf(trx, outbox.reviewSent)).toEqual({ status: "sent", error_code: null });
      expect(await outboxOf(trx, outbox.plainCard)).toEqual(kept);
      expect(await outboxOf(trx, outbox.weeklyWithout)).toEqual(kept);
      expect(await outboxOf(trx, outbox.urgentWithout)).toEqual(kept);
      expect(await outboxOf(trx, outbox.otherKind)).toEqual(kept);
    });
  });

  test("it ends every open reply send as the expiry job does, with the reason rollback, and no notice", async () => {
    await withRollback(db, async (trx) => {
      const { replies } = await seed(trx);
      await sql.raw(rollbackSql()).execute(trx);
      for (const pair of [replies.waiting, replies.waitingApplied, replies.held]) {
        expect(await actionOf(trx, pair.sendId)).toEqual({
          status: "expired",
          status_reason: "rollback",
          locked_at: null,
          next_attempt_at: null,
          result_notified_at: expect.any(Date),
        });
        expect(await auditOf(trx, pair.sendId)).toEqual([
          {
            actor: "system",
            event: "action.expired",
            reason_code: "rollback",
            data: { action_type: "send", reason: "rollback" },
          },
        ]);
      }
    });
  });

  test("a draft that was not applied ends expired with the reason send_closed; an applied draft stays", async () => {
    await withRollback(db, async (trx) => {
      const { replies } = await seed(trx);
      await sql.raw(rollbackSql()).execute(trx);
      const waiting = await actionOf(trx, replies.waiting.draftId);
      expect(waiting.status).toBe("expired");
      expect(waiting.status_reason).toBe("send_closed");
      expect(await auditOf(trx, replies.waiting.draftId)).toEqual([
        {
          actor: "system",
          event: "action.expired",
          reason_code: "send_closed",
          data: { action_type: "create_draft", reason: "expired" },
        },
      ]);
      expect((await actionOf(trx, replies.waitingApplied.draftId)).status).toBe("applied");
      // A draft step that is under way is not touched, even when its send closes.
      expect((await actionOf(trx, replies.waitingApplying.sendId)).status).toBe("expired");
      expect((await actionOf(trx, replies.waitingApplying.draftId)).status).toBe("applying");
      expect(await auditOf(trx, replies.waitingApplied.draftId)).toEqual([]);
    });
  });

  test("it leaves a send in flight, a sent reply, a rejected reply and a delegation as they were", async () => {
    await withRollback(db, async (trx) => {
      const { replies, other } = await seed(trx);
      const read = async () => ({
        applying: await actionOf(trx, replies.applying.sendId),
        applyingDraft: await actionOf(trx, replies.applying.draftId),
        sent: await actionOf(trx, replies.sent.sendId),
        rejected: await actionOf(trx, replies.rejected.sendId),
        delegation: await actionOf(trx, other.sendId),
        delegationDraft: await actionOf(trx, other.draftId),
      });
      const was = await read();
      await sql.raw(rollbackSql()).execute(trx);
      expect(await read()).toEqual(was);
      expect(was.applying.status).toBe("applying");
      expect(was.sent.status).toBe("applied");
      expect(was.delegation.status).toBe("awaiting_approval");
    });
  });

  test("the notice statement alone leaves every action as it was (a target from stage 04 on)", async () => {
    await withRollback(db, async (trx) => {
      const { replies, outbox } = await seed(trx);
      await sql.raw(noticeSql()).execute(trx);
      expect((await actionOf(trx, replies.waiting.sendId)).status).toBe("awaiting_approval");
      expect((await actionOf(trx, replies.held.sendId)).status).toBe("approved");
      expect(await outboxOf(trx, outbox.readyPending)).toEqual({ status: "failed", error_code: "outdated" });
    });
  });

  test("it is safe to run twice", async () => {
    await withRollback(db, async (trx) => {
      const { replies, outbox } = await seed(trx);
      await sql.raw(rollbackSql()).execute(trx);
      await sql.raw(rollbackSql()).execute(trx);
      expect((await actionOf(trx, replies.waiting.sendId)).status_reason).toBe("rollback");
      expect(await auditOf(trx, replies.waiting.sendId)).toHaveLength(1);
      expect(await outboxOf(trx, outbox.readyPending)).toEqual({ status: "failed", error_code: "outdated" });
    });
  });
});
