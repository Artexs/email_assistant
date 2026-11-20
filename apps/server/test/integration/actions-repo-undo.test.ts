import { HOUR_MS, DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "kysely";

import {
  insertReverse,
  listFailedUnnotified,
  lockActionsForUndo,
  lockLatestOriginalMove,
  markNotified,
  markUndone,
} from "../../src/modules/actions";

import { createTwoTenants, NOW, ago, actionState } from "./actions-repo-helpers";
import { createOrgWithMailbox, insertAction, insertDraftAndSend, insertTriagedWithActions } from "./fixtures";
import { testDb, withRollback } from "./helpers";

const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("markUndone", () => {
  test("only from applied", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(2 * HOUR_MS),
        actions: [
          { type: "move", status: "ready", payload: { folder: "ai_info" } },
          { type: "flag", status: "applied" },
        ],
      });
      const [readyMove, appliedFlag] = mail.actionIds as [string, string];

      expect(await markUndone(trx, a.ctx, readyMove, { at: NOW, reason: "undo" })).toBe(false);
      expect((await actionState(trx, readyMove)).status).toBe("ready");

      expect(await markUndone(trx, a.ctx, appliedFlag, { at: NOW, reason: "user_moved_back" })).toBe(true);
      expect(await actionState(trx, appliedFlag)).toMatchObject({ status: "undone", status_reason: "user_moved_back" });
      expect(await markUndone(trx, a.ctx, appliedFlag, { at: NOW, reason: "undo" })).toBe(false);
    });
  });
});

describe("insertReverse", () => {
  test("a second call returns null and only one reverse row exists", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(2 * HOUR_MS),
        actions: [{ type: "move", status: "applied", payload: { folder: "ai_info" } }],
      });
      const [original] = mail.actionIds as [string];
      const input = { id: original, emailId: mail.emailId, type: "move" as const, payload: { folder: "ai_info" } };

      const first = await insertReverse(trx, a.ctx, input);
      expect(first).not.toBeNull();
      expect(await insertReverse(trx, a.ctx, input)).toBeNull();

      const reverses = await trx
        .selectFrom("actions")
        .selectAll()
        .where("org_id", "=", a.ctx.orgId)
        .where("reverses_action_id", "=", original)
        .execute();
      expect(reverses).toHaveLength(1);
      expect(reverses[0]).toMatchObject({
        id: first,
        status: "ready",
        type: "move",
        payload: { folder: "ai_info" },
        idempotency_key: `${original}:undo`,
      });
    });
  });
});

describe("lockActionsForUndo and lockLatestOriginalMove", () => {
  test("lockActionsForUndo returns the originals of mailbox types with their reverse", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(2 * HOUR_MS),
        actions: [
          { type: "save_summary", status: "applied", payload: { summary: "s" } },
          { type: "flag", status: "applied" },
          { type: "move", status: "applied", payload: { folder: "ai_info" } },
        ],
      });
      const [, flag, move] = mail.actionIds as [string, string, string];
      const reverse = await insertReverse(trx, a.ctx, {
        id: move,
        emailId: mail.emailId,
        type: "move",
        payload: { folder: "ai_info" },
      });

      // the rows share one created_at: the order falls back to the random id
      const candidates = (await lockActionsForUndo(trx, a.ctx, mail.emailId)).sort((x, y) =>
        x.type.localeCompare(y.type)
      );
      expect(candidates).toEqual([
        { id: flag, type: "flag", payload: {}, status: "applied", appliedAt: ago(2 * HOUR_MS), reverse: null },
        {
          id: move,
          type: "move",
          payload: { folder: "ai_info" },
          status: "applied",
          appliedAt: ago(2 * HOUR_MS),
          reverse: { id: reverse as string, status: "ready" },
        },
      ]);
      expect(await lockActionsForUndo(trx, a.ctx, "00000000-0000-0000-0000-000000000000")).toEqual([]);
    });
  });

  test("lockLatestOriginalMove picks the newest original move and its reverse status", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(5 * HOUR_MS),
        actions: [{ type: "move", status: "undone", payload: { folder: "ai_info" } }],
      });
      expect(await lockLatestOriginalMove(trx, a.ctx, "00000000-0000-0000-0000-000000000000")).toBeUndefined();
      const newer = await insertAction(trx, a.ctx, mail.emailId, {
        type: "move",
        status: "applied",
        payload: { folder: "ai_info" },
        createdAt: ago(HOUR_MS),
      });
      await insertAction(trx, a.ctx, mail.emailId, { type: "flag", status: "applied", createdAt: ago(1000) });

      expect(await lockLatestOriginalMove(trx, a.ctx, mail.emailId)).toEqual({
        id: newer,
        status: "applied",
        reverseStatus: null,
      });
      await insertAction(trx, a.ctx, mail.emailId, {
        type: "move",
        status: "ready",
        payload: { folder: "ai_info" },
        reversesActionId: newer,
        createdAt: ago(500),
      });
      expect(await lockLatestOriginalMove(trx, a.ctx, mail.emailId)).toEqual({
        id: newer,
        status: "applied",
        reverseStatus: "ready",
      });
    });
  });

  test("two connections: lockLatestOriginalMove waits for the row lock of lockActionsForUndo", async () => {
    const created = await db.transaction().execute((trx) => createOrgWithMailbox(trx));
    const ctx = { orgId: created.orgId };
    try {
      const mail = await db.transaction().execute((trx) =>
        insertTriagedWithActions(trx, ctx, created.mailboxId, {
          category: "info",
          createdAt: ago(2 * HOUR_MS),
          actions: [{ type: "move", status: "applied", payload: { folder: "ai_info" } }],
        })
      );
      const [moveId] = mail.actionIds as [string];

      let code: unknown;
      await db.transaction().execute(async (trx1) => {
        await lockActionsForUndo(trx1, ctx, mail.emailId);
        try {
          await db.transaction().execute(async (trx2) => {
            await sql`SET LOCAL lock_timeout = '200ms'`.execute(trx2);
            await lockLatestOriginalMove(trx2, ctx, mail.emailId);
          });
        } catch (error) {
          code = (error as { code?: unknown }).code;
        }
      });
      expect(code).toBe("55P03");

      const after = await db.transaction().execute((trx2) => lockLatestOriginalMove(trx2, ctx, mail.emailId));
      expect(after).toEqual({ id: moveId, status: "applied", reverseStatus: null });
    } finally {
      await db.deleteFrom("organizations").where("id", "=", created.orgId).execute();
      await db.deleteFrom("users").where("id", "=", created.userId).execute();
    }
  });
});

describe("listFailedUnnotified and markNotified", () => {
  test("filters mail_not_found originals and notified rows; markNotified runs once", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const mail = await insertTriagedWithActions(trx, a.ctx, a.mailboxId, {
        category: "info",
        createdAt: ago(4 * DAY_MS),
        subject: "Quarterly plan",
        from: "boss@example.test",
        messageId: "<q@example.test>",
        actions: [
          { type: "move", status: "failed" },
          { type: "flag", status: "failed" },
          { type: "mark_read", status: "failed" },
        ],
      });
      const [notFound, old, notified] = mail.actionIds as [string, string, string];
      await trx
        .updateTable("actions")
        .set({ status_reason: "mail_not_found", updated_at: ago(2 * DAY_MS) })
        .where("id", "=", notFound)
        .execute();
      await trx
        .updateTable("actions")
        .set({ updated_at: ago(3 * DAY_MS) })
        .where("id", "=", old)
        .execute();
      await trx
        .updateTable("actions")
        .set({ notified_at: ago(DAY_MS) })
        .where("id", "=", notified)
        .execute();
      const reverse = await insertAction(trx, a.ctx, mail.emailId, {
        type: "move",
        status: "failed",
        statusReason: "mail_not_found",
        reversesActionId: notFound,
        payload: { folder: "ai_info" },
        createdAt: ago(DAY_MS),
      });

      const listed = await listFailedUnnotified(trx, a.ctx, { limit: 10 });
      expect(listed.map((row) => row.id)).toEqual([old, reverse]);
      expect(listed[0]).toMatchObject({
        email_id: mail.emailId,
        type: "flag",
        reverse: false,
        mailbox_id: a.mailboxId,
        subject: "Quarterly plan",
        from_address: "boss@example.test",
        message_id_header: "<q@example.test>",
      });
      expect(listed[0]?.updated_at.getTime()).toBe(ago(3 * DAY_MS).getTime());
      expect(listed[1]).toMatchObject({
        reverse: true,
        status_reason: "mail_not_found",
        payload: { folder: "ai_info" },
      });
      expect(await listFailedUnnotified(trx, a.ctx, { limit: 1 })).toHaveLength(1);

      expect(await markNotified(trx, a.ctx, old, NOW)).toBe(true);
      expect(await markNotified(trx, a.ctx, old, NOW)).toBe(false);
      expect((await listFailedUnnotified(trx, a.ctx, { limit: 10 })).map((row) => row.id)).toEqual([reverse]);
    });
  });
});

describe("listFailedUnnotified: sends and drafts", () => {
  test("leaves out a failed send and a failed original draft; lists a failed reverse draft and a failed move", async () => {
    await withRollback(db, async (trx) => {
      const { a } = await createTwoTenants(trx);
      const failedPair = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        draftStatus: "failed",
        sendStatus: "failed",
        createdAt: ago(HOUR_MS),
      });
      const reverse = await insertAction(trx, a.ctx, failedPair.emailId, {
        type: "create_draft",
        status: "failed",
        reversesActionId: failedPair.draftId,
        payload: { kind: "delegation", folder: "Drafts", uid: 7, reason: "rejected" },
        createdAt: ago(HOUR_MS),
      });
      const move = await insertAction(trx, a.ctx, failedPair.emailId, {
        type: "move",
        status: "failed",
        payload: { folder: "ai_info" },
        createdAt: ago(HOUR_MS),
      });

      const listed = await listFailedUnnotified(trx, a.ctx, { limit: 10 });
      expect(listed.map((row) => row.id).sort()).toEqual([reverse, move].sort());
    });
  });
});
