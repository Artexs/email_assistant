import { DAY_MS } from "@ea/core";
import { afterAll, describe, expect, test } from "bun:test";
import { type Transaction } from "kysely";

import { clearActionErrors, clearActionPayloads } from "../../src/modules/actions";
import { clearDelegationTasks, isOpenDelegationDraft } from "../../src/modules/delegation";
import type { DB } from "../../src/platform/db";

import { insertAction, insertDelegate, insertDelegation, insertDraftAndSend, insertTestEmail } from "./fixtures";
import { testDb, withRollback } from "./helpers";
import { now, ago, before90, over90, type Org, newOrg } from "./retention-clear-helpers";

// The retention clears for action payloads and errors and delegation task texts. Every test runs in a transaction that is rolled back.
const db = testDb();

afterAll(async () => {
  await db.destroy();
});

describe("clearActionPayloads", () => {
  test("clears closed payloads and ready summaries over 90 days; keeps the rest; status and updated_at stay; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const payload = { text: "Mail text" };

      async function seed(org: Org) {
        const emailId = await insertTestEmail(trx, org.ctx, org.mailboxId);
        const add = (
          type: "save_summary" | "create_draft" | "send" | "move",
          status: string,
          createdAt: Date,
          rowPayload: Record<string, unknown> = payload
        ) =>
          insertAction(trx, org.ctx, emailId, {
            type,
            status,
            createdAt,
            payload: rowPayload,
            approvedAt: type === "send" && status === "applied" ? createdAt : null,
          });
        return {
          appliedSummary: await add("save_summary", "applied", over90),
          loggedSend: await add("send", "logged", over90),
          expiredDraft: await add("create_draft", "expired", over90),
          readySummary: await add("save_summary", "ready", over90),
          appliedMove: await add("move", "applied", over90, { folder: "ai_info" }),
          appliedSendAt: await add("send", "applied", before90),
          awaitingSend: await add("send", "awaiting_approval", over90),
        };
      }
      const rowsA = await seed(a);
      const rowsB = await seed(b);
      const ids = Object.values(rowsA);
      const snapshot = () =>
        trx
          .selectFrom("actions")
          .select(["id", "payload", "status", "updated_at"])
          .where("id", "in", ids)
          .orderBy("id")
          .execute();
      const beforeRows = await snapshot();

      expect(await clearActionPayloads(trx, a.ctx, { before: before90, keep: isOpenDelegationDraft })).toBe(4);

      const afterRows = await snapshot();
      const byId = new Map(afterRows.map((row) => [row.id, row]));
      for (const key of ["appliedSummary", "loggedSend", "expiredDraft", "readySummary"] as const) {
        expect(byId.get(rowsA[key])?.payload).toEqual({});
      }
      expect(byId.get(rowsA.appliedMove)?.payload).toEqual({ folder: "ai_info" });
      expect(byId.get(rowsA.appliedSendAt)?.payload).toEqual(payload);
      expect(byId.get(rowsA.awaitingSend)?.payload).toEqual(payload);
      expect(afterRows.map((row) => [row.id, row.status, row.updated_at])).toEqual(
        beforeRows.map((row) => [row.id, row.status, row.updated_at])
      );
      const rowsOfB = await trx
        .selectFrom("actions")
        .select("payload")
        .where("id", "in", Object.values(rowsB))
        .execute();
      expect(rowsOfB.filter((row) => Object.keys(row.payload as object).length === 0)).toHaveLength(0);
      expect(await clearActionPayloads(trx, a.ctx, { before: before90, keep: isOpenDelegationDraft })).toBe(0);
    });
  });
});

describe("clearActionPayloads: applying rows and open delegations (F083)", () => {
  async function setUpdatedAt(trx: Transaction<DB>, id: string, at: Date) {
    await trx.updateTable("actions").set({ updated_at: at }).where("id", "=", id).execute();
  }
  const read = async (trx: Transaction<DB>, id: string) =>
    (await trx.selectFrom("actions").select("payload").where("id", "=", id).executeTakeFirstOrThrow()).payload;

  test("clears an applying create_draft or send over 90 days after its last change; keeps a younger one; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const payload = { text: "Mail text" };
      async function seed(org: Org) {
        const emailId = await insertTestEmail(trx, org.ctx, org.mailboxId);
        const add = async (type: "create_draft" | "send", updatedAt: Date) => {
          const id = await insertAction(trx, org.ctx, emailId, {
            type,
            status: "applying",
            createdAt: over90,
            lockedAt: over90,
            approvedAt: type === "send" ? over90 : null,
            payload,
          });
          await setUpdatedAt(trx, id, updatedAt);
          return id;
        };
        return {
          draftOver: await add("create_draft", over90),
          sendOver: await add("send", over90),
          sendRecent: await add("send", ago(DAY_MS)),
        };
      }
      const rowsA = await seed(a);
      const rowsB = await seed(b);

      expect(await clearActionPayloads(trx, a.ctx, { before: before90, keep: isOpenDelegationDraft })).toBe(2);
      expect(await read(trx, rowsA.draftOver)).toEqual({});
      expect(await read(trx, rowsA.sendOver)).toEqual({});
      expect(await read(trx, rowsA.sendRecent)).toEqual(payload);
      for (const id of Object.values(rowsB)) expect(await read(trx, id)).toEqual(payload);
      expect(await clearActionPayloads(trx, a.ctx, { before: before90, keep: isOpenDelegationDraft })).toBe(0);
    });
  });

  test("keeps the applied draft payload of an open delegation; clears it when the delegation is closed or has no reminder left", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      async function draftOf(status: string, remindersSent: number): Promise<string> {
        const delegateId = await insertDelegate(trx, a.ctx);
        const { emailId, draftId, sendId } = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
          delegateId,
          createdAt: over90,
          dueDate: "2027-03-01",
          language: "pl",
        });
        await insertDelegation(trx, a.ctx, {
          mailboxId: a.mailboxId,
          emailId,
          delegateId,
          draftActionId: draftId,
          sendActionId: sendId,
          status,
          remindersSent,
        });
        return draftId;
      }
      const sent = await draftOf("sent", 0);
      const overdueOne = await draftOf("overdue", 1);
      const overdueSpent = await draftOf("overdue", 2);
      const done = await draftOf("done", 1);
      const answered = await draftOf("answered", 0);

      await clearActionPayloads(trx, a.ctx, { before: before90, keep: isOpenDelegationDraft });

      expect(await read(trx, sent)).toMatchObject({ due_date: "2027-03-01", language: "pl" });
      expect(await read(trx, overdueOne)).toMatchObject({ due_date: "2027-03-01", language: "pl" });
      for (const id of [overdueSpent, done, answered]) expect(await read(trx, id)).toEqual({});
    });
  });

  test("a keep rule that matches no row clears the applied draft of an open delegation", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const delegateId = await insertDelegate(trx, a.ctx);
      const { emailId, draftId, sendId } = await insertDraftAndSend(trx, a.ctx, a.mailboxId, {
        delegateId,
        createdAt: over90,
        dueDate: "2027-03-01",
        language: "pl",
      });
      await insertDelegation(trx, a.ctx, {
        mailboxId: a.mailboxId,
        emailId,
        delegateId,
        draftActionId: draftId,
        sendActionId: sendId,
        status: "sent",
        remindersSent: 0,
      });

      expect(await clearActionPayloads(trx, a.ctx, { before: before90, keep: (eb) => eb.lit(false) })).toBe(1);
      expect(await read(trx, draftId)).toEqual({});
    });
  });
});

describe("clearActionErrors", () => {
  test("clears last_error when updated_at is over 90 days; keeps at-limit rows; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      async function seed(org: Org) {
        const emailId = await insertTestEmail(trx, org.ctx, org.mailboxId);
        const over = await insertAction(trx, org.ctx, emailId, { type: "move", status: "failed" });
        const at = await insertAction(trx, org.ctx, emailId, { type: "move", status: "failed" });
        for (const [id, updatedAt] of [
          [over, over90],
          [at, before90],
        ] as const) {
          await trx
            .updateTable("actions")
            .set({ last_error: "boom", updated_at: updatedAt })
            .where("id", "=", id)
            .execute();
        }
        return { over, at };
      }
      const rowsA = await seed(a);
      const rowsB = await seed(b);
      const read = async (id: string) =>
        (await trx.selectFrom("actions").select("last_error").where("id", "=", id).executeTakeFirstOrThrow())
          .last_error;

      expect(await clearActionErrors(trx, a.ctx, { before: before90 })).toBe(1);
      expect(await read(rowsA.over)).toBeNull();
      expect(await read(rowsA.at)).toBe("boom");
      expect(await read(rowsB.over)).toBe("boom");
      expect(await clearActionErrors(trx, a.ctx, { before: before90 })).toBe(0);
    });
  });
});

describe("clearDelegationTasks", () => {
  async function one(
    trx: Transaction<DB>,
    org: Org,
    status: string,
    updatedAt: Date,
    opts: { remindersSent?: number; dueAt?: Date | null } = {}
  ): Promise<string> {
    const delegateId = await insertDelegate(trx, org.ctx);
    const { emailId, draftId, sendId } = await insertDraftAndSend(trx, org.ctx, org.mailboxId, { delegateId });
    const id = await insertDelegation(trx, org.ctx, {
      mailboxId: org.mailboxId,
      emailId,
      delegateId,
      draftActionId: draftId,
      sendActionId: sendId,
      status,
      taskSummary: "Prepare the offer",
      remindersSent: opts.remindersSent,
      dueAt: opts.dueAt,
    });
    await trx.updateTable("delegations").set({ updated_at: updatedAt }).where("id", "=", id).execute();
    return id;
  }
  const read = async (trx: Transaction<DB>, id: string) =>
    (await trx.selectFrom("delegations").select("task_summary").where("id", "=", id).executeTakeFirstOrThrow())
      .task_summary;

  test("replaces the task text of a closed delegation when updated_at is over 90 days; keeps at-limit rows; org B is untouched", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const b = await newOrg(trx);
      const doneOver = await one(trx, a, "done", over90);
      const answeredOver = await one(trx, a, "answered", over90);
      const cancelledOver = await one(trx, a, "cancelled", over90);
      const doneAt = await one(trx, a, "done", before90);
      const otherOrg = await one(trx, b, "done", over90);

      expect(await clearDelegationTasks(trx, a.ctx, { before: before90 })).toBe(3);
      for (const id of [doneOver, answeredOver, cancelledOver]) expect(await read(trx, id)).toBe("[removed]");
      expect(await read(trx, doneAt)).toBe("Prepare the offer");
      expect(await read(trx, otherOrg)).toBe("Prepare the offer");
      expect(await clearDelegationTasks(trx, a.ctx, { before: before90 })).toBe(0);
    });
  });

  test("keeps the task text of an open delegation, also with a due date more than 90 days ahead; clears an overdue one with no reminder left", async () => {
    await withRollback(db, async (trx) => {
      const a = await newOrg(trx);
      const farDue = new Date(now.getTime() + 120 * DAY_MS);
      const drafted = await one(trx, a, "drafted", over90);
      const sentFar = await one(trx, a, "sent", over90, { dueAt: farDue });
      const overdueNone = await one(trx, a, "overdue", over90, { remindersSent: 0 });
      const overdueOne = await one(trx, a, "overdue", over90, { remindersSent: 1 });
      const overdueSpent = await one(trx, a, "overdue", over90, { remindersSent: 2 });

      expect(await clearDelegationTasks(trx, a.ctx, { before: before90 })).toBe(1);
      for (const id of [drafted, sentFar, overdueNone, overdueOne])
        expect(await read(trx, id)).toBe("Prepare the offer");
      expect(await read(trx, overdueSpent)).toBe("[removed]");
    });
  });
});
